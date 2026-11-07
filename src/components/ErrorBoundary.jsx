import { Component } from "react";

/**
 * If a page crashes while rendering, show a friendly message with a way out instead of a blank
 * white screen. `resetKey` (the current URL) clears the error when the visitor navigates away.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    console.error("Page error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ maxWidth: 460, textAlign: "center", background: "#fff", borderRadius: 20, padding: 28, boxShadow: "0 18px 50px rgba(0,31,77,.15)" }}>
          <div style={{ fontSize: 44 }} aria-hidden="true">⚠️</div>
          <h1 style={{ fontSize: 22, color: "#001f4d" }}>Something went wrong on this page</h1>
          <p style={{ color: "#4b5563" }}>Please reload the page. If it keeps happening, contact CHAFADIA ENTERPRISE and tell us what you were doing.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => window.location.reload()}>Reload page</button>
            <a className="btn" href="/" style={{ background: "#e5e7eb", color: "#001f4d" }}>Go to home page</a>
          </div>
        </div>
      </div>
    );
  }
}
