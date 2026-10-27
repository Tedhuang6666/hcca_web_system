from __future__ import annotations

import http.client
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = """
import os

async def app(scope, receive, send):
    if scope['type'] == 'lifespan':
        while True:
            message = await receive()
            if message['type'] == 'lifespan.startup':
                await send({'type': 'lifespan.startup.complete'})
            elif message['type'] == 'lifespan.shutdown':
                await send({'type': 'lifespan.shutdown.complete'})
                return
    else:
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
        await send({'type': 'http.response.body', 'body': str(os.getpid()).encode()})
"""


def request_worker(port: int) -> int:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", "/live")
        response = connection.getresponse()
        if response.status != 200:
            raise AssertionError(f"Unexpected status: {response.status}")
        return int(response.read())
    finally:
        connection.close()


@contextmanager
def running_server(
    *, extra_args: tuple[str, ...] = (), reload_on_start: bool = False, **settings: str
):
    # Bind before launching Gunicorn so parallel test runs cannot steal the port.
    with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile(mode="w+") as log:
        Path(directory, "runtime_app.py").write_text(APP)
        environment = {k: v for k, v in os.environ.items() if not k.startswith("GUNICORN_")}
        environment.update(settings)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            port = listener.getsockname()[1]
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "gunicorn",
                    "-c",
                    str(ROOT / "apps/api/gunicorn.conf.py"),
                    "--bind",
                    f"fd://{listener.fileno()}",
                    "--workers",
                    "1",
                    "--graceful-timeout",
                    "1",
                    "--access-logfile",
                    os.devnull,
                    *extra_args,
                    "runtime_app:app",
                ],
                cwd=directory,
                env=environment,
                pass_fds=(listener.fileno(),),
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    initial_worker = request_worker(port)
                    break
                except (OSError, http.client.HTTPException):
                    time.sleep(0.05)
            else:
                log.seek(0)
                raise AssertionError(f"Gunicorn failed to start:\n{log.read()}")
            if reload_on_start:
                process.send_signal(signal.SIGHUP)
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        if request_worker(port) != initial_worker:
                            break
                    except (OSError, http.client.HTTPException):
                        pass
                    time.sleep(0.05)
                else:
                    log.seek(0)
                    raise AssertionError(f"Gunicorn failed to reload:\n{log.read()}")
                # HUP starts the replacement before the previous worker finishes
                # graceful shutdown; exclude that expected overlap from recycling checks.
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        os.kill(initial_worker, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.05)
                else:
                    log.seek(0)
                    raise AssertionError(
                        f"Gunicorn did not retire the previous worker:\n{log.read()}"
                    )
            yield port
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)


class GunicornRuntimeTests(unittest.TestCase):
    def test_default_worker_survives_more_than_previous_recycling_limit(self) -> None:
        with running_server() as port:
            worker_pids = {request_worker(port) for _ in range(1200)}
        self.assertEqual(len(worker_pids), 1, "Routine polling must not recycle the API worker")

    def test_request_limit_overrides_cannot_reenable_recycling(self) -> None:
        cases = (
            (
                "environment",
                {"GUNICORN_MAX_REQUESTS": "5", "GUNICORN_MAX_REQUESTS_JITTER": "1"},
                (),
            ),
            ("command environment", {"GUNICORN_CMD_ARGS": "--max-requests 5"}, ()),
            ("command line", {}, ("--max-requests", "5", "--max-requests-jitter", "1")),
        )
        for name, environment, arguments in cases:
            with self.subTest(source=name):
                with running_server(extra_args=arguments, **environment) as port:
                    worker_pids = {request_worker(port) for _ in range(1200)}
                self.assertEqual(
                    len(worker_pids), 1, "Overrides must not reenable worker recycling"
                )

    def test_reload_keeps_request_count_recycling_disabled(self) -> None:
        with running_server(extra_args=("--max-requests", "500"), reload_on_start=True) as port:
            worker_pids = {request_worker(port) for _ in range(1200)}
        self.assertEqual(len(worker_pids), 1, "Reload must not reenable worker recycling")


if __name__ == "__main__":
    unittest.main()
