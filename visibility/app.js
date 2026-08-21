(() => {
  "use strict";
  // The decompressed application contains the live Social Ranking iframe: src="../index.html".
  const bundles = {
    styles: ["styles.bundle.b64"],
    application: ["app.bundle.1.b64", "app.bundle.2.b64"]
  };

  async function fetchText(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load ${path} (${response.status})`);
    return response.text();
  }

  async function inflateBase64(encoded) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser does not support the required secure bundle decompression API.");
    }
    const binary = atob(encoded.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  Promise.all([
    Promise.all(bundles.styles.map(fetchText)).then((parts) => inflateBase64(parts.join(""))),
    Promise.all(bundles.application.map(fetchText)).then((parts) => inflateBase64(parts.join("")))
  ])
    .then(([css, source]) => {
      const style = document.createElement("style");
      style.dataset.visibilityBundle = "styles";
      style.textContent = css;
      document.head.appendChild(style);

      const scriptUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.dataset.visibilityBundle = "application";
      script.addEventListener("load", () => URL.revokeObjectURL(scriptUrl), { once: true });
      script.addEventListener("error", () => {
        URL.revokeObjectURL(scriptUrl);
        throw new Error("The Visibility OS application bundle could not execute.");
      }, { once: true });
      document.body.appendChild(script);
    })
    .catch((error) => {
      console.error(error);
      const root = document.getElementById("viewRoot") || document.body;
      root.innerHTML = `<section class="bootstrap-error"><strong>Visibility OS could not load.</strong><span>${String(error.message || error)}</span></section>`;
    });
})();
