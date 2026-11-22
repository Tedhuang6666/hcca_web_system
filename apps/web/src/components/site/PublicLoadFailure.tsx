"use client";

export default function PublicLoadFailure({ message }: { message: string }) {
  return (
    <div className="public-load-failure" role="alert">
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>重新載入</button>
    </div>
  );
}
