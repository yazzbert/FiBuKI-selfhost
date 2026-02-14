/**
 * FiBuKI MAIN world hooks — injected at document_start before any page JS.
 * Wraps fetch, XHR, URL.createObjectURL, and HTMLAnchorElement.prototype.click
 * to detect and capture PDF downloads.
 */
(function () {
  "use strict";
  if (window.__taxstudioHooked) return;
  window.__taxstudioHooked = true;

  function isPdf(headers) {
    var ct = (headers["content-type"] || "").toLowerCase();
    return ct.indexOf("pdf") !== -1;
  }

  // --- fetch wrapper ---
  var origFetch = window.fetch;
  window.fetch = function () {
    var url = "";
    try {
      url = typeof arguments[0] === "string" ? arguments[0] : (arguments[0] && arguments[0].url) || "";
    } catch (e) {}
    // Skip blob: URLs — PDFs from blobs are captured by the createObjectURL hook
    if (url && url.indexOf("blob:") === 0) {
      return origFetch.apply(this, arguments);
    }
    return origFetch.apply(this, arguments).then(function (resp) {
      try {
        var headers = {};
        resp.headers.forEach(function (value, key) {
          headers[key.toLowerCase()] = value;
        });
        if (isPdf(headers) || resp.url.toLowerCase().indexOf(".pdf") !== -1) {
          window.postMessage(
            { type: "TS_NETWORK_PDF", url: resp.url, headers: headers },
            "*"
          );
        }
      } catch (e) {}
      return resp;
    });
  };

  // --- XHR wrapper ---
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    this.__tsUrl = arguments[1];
    return origOpen.apply(this, arguments);
  };
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        var ct = this.getResponseHeader("content-type") || "";
        var headers = { "content-type": ct };
        var url = this.responseURL || this.__tsUrl || "";
        if (
          isPdf(headers) ||
          String(url).toLowerCase().indexOf(".pdf") !== -1
        ) {
          window.postMessage(
            { type: "TS_NETWORK_PDF", url: url, headers: headers },
            "*"
          );
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };

  // --- URL.createObjectURL wrapper ---
  var origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    var blobUrl = origCreateObjectURL.call(URL, obj);
    try {
      if (obj instanceof Blob && obj.size > 100) {
        var blobType = (obj.type || "").toLowerCase();
        // Skip types that are definitely NOT PDFs
        var isNotPdf =
          blobType.indexOf("image/") === 0 ||
          blobType.indexOf("video/") === 0 ||
          blobType.indexOf("audio/") === 0 ||
          blobType.indexOf("font/") === 0 ||
          blobType.indexOf("text/css") === 0 ||
          blobType.indexOf("text/javascript") === 0 ||
          blobType.indexOf("text/html") === 0;
        if (!isNotPdf) {
          // Read first bytes to check for PDF magic (%PDF)
          var sliceForCheck = obj.slice(0, 5);
          var magicReader = new FileReader();
          magicReader.onload = function () {
            try {
              var header = new Uint8Array(magicReader.result);
              if (
                header.length >= 4 &&
                header[0] === 0x25 &&
                header[1] === 0x50 &&
                header[2] === 0x44 &&
                header[3] === 0x46
              ) {
                console.log(
                  "[FiBuKI-MAIN] PDF blob detected via createObjectURL, type:",
                  blobType,
                  "size:",
                  obj.size
                );
                // It's a PDF — read the full blob
                var fullReader = new FileReader();
                fullReader.onload = function () {
                  try {
                    var bytes = new Uint8Array(fullReader.result);
                    var binary = "";
                    for (var i = 0; i < bytes.length; i++) {
                      binary += String.fromCharCode(bytes[i]);
                    }
                    var base64 = btoa(binary);
                    window.postMessage(
                      { type: "TS_BLOB_PDF", base64: base64, blobUrl: blobUrl },
                      "*"
                    );
                  } catch (e) {
                    console.warn("[FiBuKI-MAIN] TS_BLOB_PDF encode error:", e);
                  }
                };
                fullReader.readAsArrayBuffer(obj);
              }
            } catch (e) {}
          };
          magicReader.readAsArrayBuffer(sliceForCheck);
        }
      }
    } catch (e) {}
    return blobUrl;
  };

  // --- HTMLAnchorElement.prototype.click wrapper ---
  var origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      var downloadAttr = this.getAttribute("download");
      var href = this.href || "";
      if (
        downloadAttr !== null &&
        (href.indexOf("blob:") === 0 || href.indexOf("data:") === 0)
      ) {
        window.postMessage(
          {
            type: "TS_ANCHOR_DOWNLOAD",
            href: href,
            filename: downloadAttr || "download.pdf",
          },
          "*"
        );
      }
    } catch (e) {}
    return origAnchorClick.apply(this, arguments);
  };
})();
