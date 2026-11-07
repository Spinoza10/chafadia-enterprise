import { Alert, Badge, StaffLayout } from "../../components/staff/StaffLayout";
import { api, formatDate } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

/** Messages sent from the public Contact page. */
function CustomerMessages() {
  const { data, error, reload } = useApi("/api/messages");
  const action = useAction();
  const messages = data?.data ?? [];

  const setStatus = (m, status) => action.run(async () => {
    await api.patch(`/api/messages/${m.id}`, { status });
    await reload();
  });

  return (
    <StaffLayout title="Customer messages" subtitle="Questions and requests sent through the Contact page.">
      <Alert kind="error">{error || action.error}</Alert>
      <div className="st-grid-2">
        {messages.map((m) => (
          <section className="st-card" key={m.id}>
            <div className="st-toolbar" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{m.subject || "No subject"}</h3>
              <Badge status={m.status} />
            </div>
            <p className="st-muted">{m.name} - {formatDate(m.createdAt)}</p>
            <p style={{ whiteSpace: "pre-wrap" }}>{m.message}</p>
            <div className="st-actions">
              {m.email && <a className="st-btn small" href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject ?? "your message"}`)}`} onClick={() => setStatus(m, "replied")}>Reply by email</a>}
              {m.phone && <a className="st-btn light small" href={`https://wa.me/${m.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}
              {m.status === "new" && <button className="st-btn light small" onClick={() => setStatus(m, "read")}>Mark read</button>}
              {m.status !== "archived" && <button className="st-btn light small" onClick={() => setStatus(m, "archived")}>Archive</button>}
            </div>
          </section>
        ))}
      </div>
      {!messages.length && <div className="st-card st-empty">No messages yet.</div>}
    </StaffLayout>
  );
}

export default CustomerMessages;
