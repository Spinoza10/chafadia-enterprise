import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * A payment screenshot. The API only serves it to staff with payments.verify and to the order's
 * owner, so it is fetched with the app's credentials and shown from a temporary object URL.
 */
export default function ProofImage({ src, alt = "Payment screenshot", style, onOpen }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let objectUrl;
    let stopped = false;
    api
      .blob(src)
      .then((blob) => {
        if (stopped) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed) return <div className="st-muted" style={{ padding: 20, ...style }}>Screenshot unavailable</div>;
  if (!url) return <div className="st-muted" style={{ padding: 20, ...style }}>Loading screenshot...</div>;
  if (broken) {
    return (
      <div className="st-alert warn" style={{ ...style, maxHeight: "none" }}>
        This image file cannot be displayed (it may be damaged). <a href={url} download="payment-screenshot" style={{ textDecoration: "underline", fontWeight: 800 }}>Download it</a> to check, or reject it and ask the customer for a new screenshot.
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      onError={() => setBroken(true)}
      onClick={() => (onOpen ? onOpen(url) : window.open(url, "_blank", "noopener"))}
      style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid #e5e7eb", cursor: "zoom-in", objectFit: "contain", ...style }}
    />
  );
}
