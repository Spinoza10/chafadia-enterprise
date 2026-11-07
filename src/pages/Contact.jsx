import { useState } from "react";
import Navbar from "../components/Navbar";
import { api } from "../lib/api";
import heroImage from "../assets/images/home-page3.png";

function Contact() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    category: "General Inquiry",
    message: "",
  });

  const contactCards = [
    {
      icon: "📞",
      title: "Call Support",
      text: "Speak directly with Chafadia Enterprise for orders and assistance.",
      value: "+237 6 52 43 33 33",
      link: "tel:+237652433333",
    },
    {
      icon: "🟧",
      title: "Orange Money / Contact",
      text: "Customer support and payment confirmation line.",
      value: "+237 6 88 33 26 99",
      link: "tel:+237688332699",
    },
    {
      icon: "✉️",
      title: "Email Us",
      text: "Send product, partnership, order and support requests.",
      value: "chafadiaenterprise@gmail.com",
      link: "mailto:chafadiaenterprise@gmail.com",
    },
    {
      icon: "📍",
      title: "Visit Location",
      text: "Nkolmesseng, Yaoundé, Cameroon.",
      value: "Yaoundé, Cameroon",
      link: "#location",
    },
  ];

  const services = [
    "Chafadia Enterprise Feminine Secrets",
    "Chafadia Enterprise Botanicals",
    "Chafadia Enterprise Halal Drinks",
    "Chafadia Enterprise Crips Co.",
    "Hygiene & Cleaning Products",
    "Customer Orders & Payments",
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Saved for the team's Customer Messages screen.
      const res = await api.post("/api/contact", {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        subject: [form.category, form.subject].filter(Boolean).join(" - ") || undefined,
        message: form.message,
      });
      alert(res.message);
      setForm({ name: "", email: "", phone: "", subject: "", category: "General Inquiry", message: "" });
      return;
    } catch (err) {
      if (err.status && err.status < 500) {
        alert(err.message);
        return;
      }
      // API unreachable: fall back to the visitor's email app
    }

    const message = `
CHAFADIA ENTERPRISE CONTACT MESSAGE

Name: ${form.name}
Email: ${form.email}
Phone: ${form.phone}
Category: ${form.category}
Subject: ${form.subject}

Message:
${form.message}
`.trim();

    const mailLink = `mailto:chafadiaenterprise@gmail.com?subject=${encodeURIComponent(
      form.subject || "Chafadia Enterprise Contact Message"
    )}&body=${encodeURIComponent(message)}`;

    window.location.href = mailLink;
  };

  return (
    <>
      <Navbar />

      <div className="contact-page">
        <style>{`
          .contact-page {
            min-height: 100vh;
            background:
              radial-gradient(circle at 8% 8%, rgba(212, 175, 55, 0.24), transparent 28%),
              radial-gradient(circle at 90% 10%, rgba(0, 74, 173, 0.16), transparent 30%),
              linear-gradient(135deg, #f6f8ff 0%, #ffffff 52%, #f7f9ff 100%);
            padding: 28px;
          }

          .contact-container {
            max-width: 1250px;
            margin: 0 auto;
          }

          .contact-hero-premium {
            position: relative;
            overflow: hidden;
            min-height: 380px;
            border-radius: 42px;
            display: flex;
            align-items: center;
            padding: 42px;
            margin-bottom: 25px;
            background-image:
              linear-gradient(
                135deg,
                rgba(0, 31, 77, 0.88),
                rgba(0, 74, 173, 0.62),
                rgba(0, 31, 77, 0.78)
              ),
              url(${heroImage});
            background-size: cover;
            background-position: center;
            border: 1px solid rgba(212, 175, 55, 0.45);
            box-shadow:
              0 34px 85px rgba(0, 31, 77, 0.25),
              inset 0 1px 0 rgba(255, 255, 255, 0.16);
          }

          .contact-hero-premium::before {
            content: "";
            position: absolute;
            width: 360px;
            height: 360px;
            right: -150px;
            top: -150px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(212,175,55,0.42), transparent 68%);
          }

          .contact-hero-premium::after {
            content: "";
            position: absolute;
            inset: 18px;
            border-radius: 32px;
            border: 1px solid rgba(255,255,255,0.16);
            pointer-events: none;
          }

          .contact-hero-content {
            position: relative;
            z-index: 2;
            max-width: 780px;
          }

          .contact-label {
            display: inline-flex;
            padding: 9px 16px;
            border-radius: 999px;
            margin-bottom: 16px;
            background: rgba(212, 175, 55, 0.18);
            color: #fff7d6;
            border: 1px solid rgba(212, 175, 55, 0.45);
            font-size: 12px;
            font-weight: 950;
            letter-spacing: 0.9px;
            text-transform: uppercase;
            backdrop-filter: blur(8px);
          }

          .contact-hero-content h1 {
            color: #ffffff;
            font-size: clamp(38px, 6vw, 68px);
            line-height: 1.02;
            font-weight: 950;
            letter-spacing: -1.7px;
            margin-bottom: 15px;
          }

          .contact-hero-content h1 span {
            background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          }

          .contact-hero-content p {
            color: rgba(255,255,255,0.9);
            max-width: 720px;
            line-height: 1.8;
            font-size: 16px;
            font-weight: 650;
          }

          .contact-hero-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 13px;
            margin-top: 24px;
          }

          .hero-contact-btn {
            min-height: 48px;
            padding: 0 20px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            font-weight: 950;
            text-decoration: none;
            transition: 0.3s ease;
          }

          .hero-contact-btn.primary {
            background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
            color: #001f4d;
            box-shadow: 0 16px 36px rgba(212,175,55,0.24);
          }

          .hero-contact-btn.secondary {
            background: rgba(255,255,255,0.1);
            color: #ffffff;
            border: 1px solid rgba(255,255,255,0.26);
            backdrop-filter: blur(8px);
          }

          .hero-contact-btn:hover {
            transform: translateY(-3px);
            filter: brightness(1.05);
          }

          .contact-cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
          }

          .contact-mini-card {
            background: rgba(255,255,255,0.98);
            border: 1px solid rgba(212,175,55,0.2);
            border-radius: 25px;
            padding: 18px;
            box-shadow: 0 16px 42px rgba(0,31,77,0.09);
            transition: 0.3s ease;
            text-decoration: none;
            color: inherit;
            position: relative;
            overflow: hidden;
          }

          .contact-mini-card::after {
            content: "";
            position: absolute;
            width: 90px;
            height: 90px;
            right: -40px;
            top: -40px;
            border-radius: 50%;
            background: rgba(212,175,55,0.16);
          }

          .contact-mini-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 24px 55px rgba(0,31,77,0.14);
          }

          .contact-icon {
            width: 48px;
            height: 48px;
            border-radius: 17px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #004aad, #001f4d);
            color: #d4af37;
            font-size: 22px;
            margin-bottom: 12px;
          }

          .contact-mini-card h3 {
            color: #001f4d;
            font-size: 17px;
            font-weight: 950;
            margin-bottom: 6px;
          }

          .contact-mini-card p {
            color: #667085;
            font-size: 13px;
            line-height: 1.55;
            font-weight: 650;
          }

          .contact-mini-card strong {
            display: block;
            margin-top: 9px;
            color: #b8860b;
            font-size: 13px;
            word-break: break-word;
          }

          .contact-layout-premium {
            display: grid;
            grid-template-columns: minmax(0, 1.1fr) minmax(330px, 0.9fr);
            gap: 22px;
            align-items: start;
          }

          .contact-panel {
            background: rgba(255,255,255,0.985);
            border-radius: 32px;
            border: 1px solid rgba(212,175,55,0.22);
            box-shadow: 0 22px 58px rgba(0,31,77,0.11);
            overflow: hidden;
          }

          .panel-head {
            padding: 24px;
            background:
              linear-gradient(135deg, rgba(0,74,173,0.08), rgba(212,175,55,0.13));
            border-bottom: 1px solid rgba(0,74,173,0.08);
          }

          .panel-head h2 {
            color: #001f4d;
            font-size: 27px;
            font-weight: 950;
            margin-bottom: 7px;
          }

          .panel-head p {
            color: #667085;
            font-size: 14px;
            line-height: 1.65;
            font-weight: 650;
          }

          .contact-form {
            padding: 22px;
            display: grid;
            gap: 14px;
          }

          .form-two {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
          }

          .contact-form input,
          .contact-form select,
          .contact-form textarea {
            width: 100%;
            padding: 15px 17px;
            border-radius: 18px;
            border: 1px solid rgba(0,74,173,0.14);
            background: #ffffff;
            color: #001f4d;
            font-weight: 760;
            box-shadow: 0 10px 25px rgba(0,31,77,0.055);
            outline: none;
            transition: 0.28s ease;
            font-family: inherit;
          }

          .contact-form textarea {
            min-height: 150px;
            resize: vertical;
          }

          .contact-form input:focus,
          .contact-form select:focus,
          .contact-form textarea:focus {
            border-color: #d4af37;
            box-shadow: 0 0 0 4px rgba(212,175,55,0.14);
          }

          .send-message-btn {
            border: none;
            min-height: 52px;
            border-radius: 999px;
            background: linear-gradient(135deg, #004aad, #001f4d);
            color: #ffffff;
            font-weight: 950;
            cursor: pointer;
            box-shadow: 0 18px 38px rgba(0,31,77,0.16);
            transition: 0.3s ease;
          }

          .send-message-btn:hover {
            transform: translateY(-3px);
            background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
            color: #001f4d;
          }

          .business-info-body {
            padding: 22px;
            display: grid;
            gap: 15px;
          }

          .info-row {
            display: grid;
            grid-template-columns: 44px 1fr;
            gap: 12px;
            align-items: start;
            padding: 14px;
            border-radius: 20px;
            background: #f8fbff;
            border: 1px solid rgba(0,74,173,0.08);
          }

          .info-row-icon {
            width: 44px;
            height: 44px;
            border-radius: 16px;
            background: linear-gradient(135deg, #fff7d6, #d4af37);
            color: #001f4d;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 19px;
          }

          .info-row h3 {
            color: #001f4d;
            font-size: 15px;
            font-weight: 950;
            margin-bottom: 5px;
          }

          .info-row p {
            color: #667085;
            line-height: 1.55;
            font-size: 13.5px;
            font-weight: 700;
          }

          .services-box {
            padding: 18px;
            border-radius: 24px;
            background:
              linear-gradient(135deg, #004aad, #001f4d);
            color: #ffffff;
            box-shadow: 0 18px 40px rgba(0,31,77,0.18);
          }

          .services-box h3 {
            color: #d4af37;
            margin-bottom: 12px;
            font-size: 18px;
            font-weight: 950;
          }

          .services-list {
            display: grid;
            gap: 8px;
          }

          .service-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            color: rgba(255,255,255,0.92);
            font-size: 13px;
            font-weight: 760;
          }

          .service-pill::before {
            content: "✓";
            color: #d4af37;
            font-weight: 950;
          }

          .support-strip {
            margin-top: 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 15px;
          }

          .support-card {
            background: rgba(255,255,255,0.985);
            border-radius: 25px;
            padding: 20px;
            border: 1px solid rgba(212,175,55,0.2);
            box-shadow: 0 16px 40px rgba(0,31,77,0.09);
          }

          .support-card h3 {
            color: #001f4d;
            font-size: 17px;
            font-weight: 950;
            margin-bottom: 8px;
          }

          .support-card p {
            color: #667085;
            font-size: 13.5px;
            line-height: 1.6;
            font-weight: 680;
          }

          @media (max-width: 980px) {
            .contact-layout-premium {
              grid-template-columns: 1fr;
            }

            .contact-hero-premium {
              min-height: 350px;
              padding: 30px;
            }
          }

          @media (max-width: 650px) {
            .contact-page {
              padding: 14px;
            }

            .contact-hero-premium {
              border-radius: 28px;
              min-height: 390px;
              padding: 22px 16px;
            }

            .contact-hero-actions,
            .form-two {
              grid-template-columns: 1fr;
              flex-direction: column;
            }

            .hero-contact-btn {
              width: 100%;
            }

            .panel-head,
            .contact-form,
            .business-info-body {
              padding: 17px;
            }
          }
        `}</style>

        <div className="contact-container">
          <section className="contact-hero-premium">
            <div className="contact-hero-content">
              <span className="contact-label">Customer Care & Business Support</span>

              <h1>
                Contact <span>Chafadia Enterprise</span>
              </h1>

              <p>
                We are here for orders, product inquiries, partnerships,
                customer care, payment confirmation and support. Your message
                matters to us, and we are always happy to help.
              </p>

              <div className="contact-hero-actions">
                <a href="tel:+237652433333" className="hero-contact-btn primary">
                  Call Now
                </a>

                <a
                  href="mailto:chafadiaenterprise@gmail.com"
                  className="hero-contact-btn secondary"
                >
                  Send Email
                </a>
              </div>
            </div>
          </section>

          <div className="contact-cards-grid">
            {contactCards.map((card) => (
              <a className="contact-mini-card" href={card.link} key={card.title}>
                <div className="contact-icon">{card.icon}</div>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
                <strong>{card.value}</strong>
              </a>
            ))}
          </div>

          <div className="contact-layout-premium">
            <div className="contact-panel">
              <div className="panel-head">
                <h2>Send Us a Message</h2>
                <p>
                  Fill this form and your email app will open with a complete
                  message ready to send to Chafadia Enterprise.
                </p>
              </div>

              <form className="contact-form" onSubmit={handleSubmit}>
                <div className="form-two">
                  <input
                    type="text"
                    placeholder="Full Name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />

                  <input
                    type="email"
                    placeholder="Email Address"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div className="form-two">
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />

                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                  >
                    <option>General Inquiry</option>
                    <option>Product Order</option>
                    <option>Payment Confirmation</option>
                    <option>Partnership</option>
                    <option>Delivery Support</option>
                    <option>Customer Complaint</option>
                    <option>Wholesale Request</option>
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="Subject"
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />

                <textarea
                  placeholder="Your Message"
                  required
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                ></textarea>

                <button className="send-message-btn" type="submit">
                  Send Message
                </button>
              </form>
            </div>

            <div className="contact-panel contact-info">
              <div className="panel-head">
                <h2>Business Information</h2>
                <p>
                  Official contact details for Chafadia Enterprise customers,
                  partners and suppliers.
                </p>
              </div>

              <div className="business-info-body">
                <div className="info-row">
                  <div className="info-row-icon">🏢</div>
                  <div>
                    <h3>Brand</h3>
                    <p>CHAFADIA ENTERPRISE</p>
                  </div>
                </div>

                <div className="info-row" id="location">
                  <div className="info-row-icon">📍</div>
                  <div>
                    <h3>Location</h3>
                    <p>Nkolmesseng, Yaoundé, Cameroon</p>
                  </div>
                </div>

                <div className="info-row">
                  <div className="info-row-icon">✉️</div>
                  <div>
                    <h3>Email</h3>
                    <p>chafadiaenterprise@gmail.com</p>
                  </div>
                </div>

                <div className="info-row">
                  <div className="info-row-icon">📞</div>
                  <div>
                    <h3>Phone</h3>
                    <p>+237 6 52 43 33 33 | +237 6 88 33 26 99</p>
                  </div>
                </div>

                <div className="info-row">
                  <div className="info-row-icon">⏰</div>
                  <div>
                    <h3>Business Hours</h3>
                    <p>Monday - Saturday: 8:00 AM - 5:00 PM</p>
                  </div>
                </div>

                <div className="services-box">
                  <h3>Our Services</h3>

                  <div className="services-list">
                    {services.map((service) => (
                      <div className="service-pill" key={service}>
                        {service}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="support-strip">
            <div className="support-card">
              <h3>Fast Order Support</h3>
              <p>
                Contact us for product availability, order confirmation,
                delivery updates and payment verification.
              </p>
            </div>

            <div className="support-card">
              <h3>Partnership & Wholesale</h3>
              <p>
                Suppliers, retailers and partners can reach out for business
                collaboration and wholesale opportunities.
              </p>
            </div>

            <div className="support-card">
              <h3>Customer Happiness First</h3>
              <p>
                We value every customer and work to provide respectful,
                professional and caring support.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Contact;
