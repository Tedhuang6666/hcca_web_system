(() => {
  try {
    let theme = localStorage.getItem("hcca-theme");
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch {
    // Theme preference is optional and must never prevent page rendering.
  }
})();
