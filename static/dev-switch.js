fetch("/api/ui-config").then((response) => response.json()).then((config) => {
    if (!config.show_mode_switch) document.querySelectorAll("[data-dev-only]").forEach((item) => item.remove());
}).catch(() => {});
