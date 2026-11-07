import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

import globalLogo from "../assets/images/chafadia-global.png";
import enterpriseLogo from "../assets/images/chafadia-enterprise1.png";
import feminineLogo from "../assets/images/chafadia-feminine.png";
import cripsLogo from "../assets/images/chafadia-cripsco.png";
import drinksLogo from "../assets/images/chafadia-drinks.png";
import botanicalsLogo from "../assets/images/chafadia-botanicals.png";
import premiumProductsLogo from "../assets/images/chafadia-PremiumP1.png";
import techEmpireLogo from "../assets/images/chafadia-empire.png";
import cybersecurityLogo from "../assets/images/chafadia-cybersecurity.png";
import familyWomenLogo from "../assets/images/chafadia-family&W.png";
import foundationLogo from "../assets/images/chafadia-foundation.png";
import consultationLogo from "../assets/images/chafadia-consultation.png";
import academyLogo from "../assets/images/chafadia-academy.png";
import heroImage from "../assets/images/home-page3.png";

function Home() {
  const enterpriseHighlights = [
    {
      number: "01",
      title: "Premium Lifestyle Products",
      text: "Beauty, wellness, fashion, halal beverages, gourmet snacks, hygiene and family essentials crafted with elegance.",
    },
    {
      number: "02",
      title: "Global Group Vision",
      text: "A signature brand shaped by the wider vision, structure and excellence of Chafadia Global Group.",
    },
    {
      number: "03",
      title: "One Trusted Identity",
      text: "Specialized product brands working together under one refined standard of quality, innovation and premium value.",
    },
  ];

  const enterpriseBrands = [
    {
      logo: feminineLogo,
      title: "Chafadia Feminine Secrets",
      label: "Fashion • Beauty • Women Essentials",
      text: "Modest fashion, perfumes, body care, hijabs, accessories and feminine lifestyle essentials.",
    },
    {
      logo: botanicalsLogo,
      title: "Chafadia Botanicals",
      label: "Natural Care • Wellness",
      text: "Botanical products, wellness essentials and trusted care solutions for homes and families.",
    },
    {
      logo: cripsLogo,
      title: "Chafadia Crips Co.",
      label: "Premium Snacks",
      text: "Banana, potato, beef and chicken chips made crunchy, clean, flavorful and beautifully packaged.",
    },
    {
      logo: drinksLogo,
      title: "Chafadia Halal Drinks",
      label: "Fresh • Natural • Halal",
      text: "Refreshing juices, zobo, yogurt drinks, cocktails and healthy halal beverages for all occasions.",
    },
    {
      logo: premiumProductsLogo,
      title: "Chafadia Premium Products",
      label: "Quality • Care • Lifestyle",
      text: "A premium product line for beauty, hygiene, family care, cleanliness and everyday lifestyle needs.",
    },
  ];

  const globalBrands = [
    {
      logo: globalLogo,
      title: "Chafadia Global Group",
      label: "Parent Organization",
      text: "The global umbrella connecting enterprise, technology, education, empowerment, consultation and social impact.",
    },
    {
      logo: techEmpireLogo,
      title: "Chafadia Tech Empire",
      label: "Technology & Digital Innovation",
      text: "Web development, mobile applications, digital systems and modern technology solutions.",
    },
    {
      logo: cybersecurityLogo,
      title: "Chafadia Cybersecurity",
      label: "Security • Protection • Awareness",
      text: "Cybersecurity services, awareness, ethical hacking, digital safety and protection-focused solutions.",
    },
    {
      logo: consultationLogo,
      title: "Chafadia Consultation",
      label: "Strategy • Writing • Guidance",
      text: "Project drafting, business orientation, planning, professional writing and brand consultation.",
    },
    {
      logo: foundationLogo,
      title: "Chafadia Foundation",
      label: "Humanity • Support • Impact",
      text: "A social impact arm focused on hope, community support, education and meaningful assistance.",
    },
    {
      logo: familyWomenLogo,
      title: "Chafadia Women & Family",
      label: "Family • Care • Guidance",
      text: "Support for women, family growth, marital guidance, intimacy education and family wellbeing.",
    },
    {
      logo: familyWomenLogo,
      title: "Chafadia Women Empowerment",
      label: "Women • Skills • Confidence",
      text: "Empowering women through knowledge, skills, confidence, entrepreneurship and personal development.",
    },
    {
      logo: academyLogo,
      title: "Chafadia Academy",
      label: "Education • Training • Growth",
      text: "Learning, courses, training, mentorship and professional development for future-ready people.",
    },
  ];

  return (
    <>
      <Navbar />

      <main>
        <section
          className="home-hero enterprise-hero"
          style={{ backgroundImage: `url(${heroImage})` }}
        >
          <div className="enterprise-hero-card">
            <div className="enterprise-logo-wrap">
              <div className="enterprise-logo-orbit">
                <img src={enterpriseLogo} alt="CHAFADIA ENTERPRISE" />
              </div>

              <span>A Signature Brand of Chafadia Global Group</span>
            </div>

            <h1>
              CHAFADIA <span className="gold">ENTERPRISE</span>
            </h1>

            <h2>Where Vision Becomes Legacy</h2>

            <p>
              Built on a foundation of excellence, Chafadia Enterprise delivers
              an exceptional portfolio of premium lifestyle products spanning
              beauty, wellness, fashion, halal beverages, gourmet snacks,
              hygiene and everyday family essentials crafted to enrich lives
              through quality, elegance and innovation.
            </p>

            <div className="hero-buttons enterprise-buttons">
              <Link to="/products">Explore Products</Link>
              <Link to="/about">Discover Our Brand</Link>
            </div>
          </div>
        </section>

        <section className="page enterprise-premium-section">
          <div className="container">
            <div className="enterprise-section-head">
              <span>✦ CHAFADIA ENTERPRISE EXPERIENCE ✦</span>
              <h2>Crafting Premium Experiences for Everyday Living</h2>
              <p>
                Chafadia Enterprise brings together a carefully curated portfolio
                of specialized product brands, each serving a unique market while
                sharing one uncompromising standard of excellence, innovation
                and premium quality.
              </p>
            </div>

            <div className="enterprise-highlight-grid">
              {enterpriseHighlights.map((item) => (
                <div className="enterprise-highlight-card" key={item.title}>
                  <strong>{item.number}</strong>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>

            <div className="brand-architecture">
              <div className="architecture-parent">
                <img src={globalLogo} alt="CHAFADIA GLOBAL GROUP" />
                <div>
                  <span>Parent Organization</span>
                  <h3>CHAFADIA GLOBAL GROUP</h3>
                  <p>
                    The central vision connecting enterprise, technology,
                    cybersecurity, consultation, academy, foundation, women
                    empowerment and family development.
                  </p>
                </div>
              </div>

              <div className="architecture-line"></div>

              <div className="architecture-enterprise">
                <img src={enterpriseLogo} alt="CHAFADIA ENTERPRISE" />
                <div>
                  <span>A Signature Brand</span>
                  <h3>CHAFADIA ENTERPRISE</h3>
                  <p>
                    Built on a foundation of excellence, this enterprise serves
                    customers through premium lifestyle products, trusted
                    essentials and a refined family of specialized brands.
                  </p>
                </div>
              </div>
            </div>

            <div className="enterprise-section-head second-head">
              <span>✦ THE CHAFADIA ENTERPRISE PORTFOLIO ✦</span>
              <h2>The Chafadia Enterprise Portfolio</h2>
              <p>
                An integrated portfolio of premium lifestyle brands encompassing
                Chafadia Feminine Secrets, Chafadia Botanicals, Chafadia Crips
                Co., Chafadia Halal Drinks and Chafadia Premium Products working
                together under one trusted identity to deliver excellence across
                every customer experience.
              </p>
            </div>

            <div className="enterprise-master-card">
              <div className="enterprise-master-logo">
                <img src={enterpriseLogo} alt="CHAFADIA ENTERPRISE" />
              </div>

              <div className="enterprise-master-content">
                <span>Integrated Portfolio of Premium Lifestyle Brands</span>
                <h3>CHAFADIA ENTERPRISE</h3>
                <p>
                  An integrated portfolio of premium lifestyle brands encompassing
                  Chafadia Feminine Secrets, Chafadia Botanicals, Chafadia Crips
                  Co., Chafadia Halal Drinks and Chafadia Premium Products
                  working together under one trusted identity to deliver
                  excellence across every customer experience.
                </p>
              </div>
            </div>

            <div className="enterprise-brand-grid">
              {enterpriseBrands.map((brand) => (
                <div className="brand-card enterprise-brand-card" key={brand.title}>
                  <div className="brand-logo-frame">
                    <img src={brand.logo} alt={brand.title} />
                  </div>

                  <div className="brand-card-body">
                    <span>{brand.label}</span>
                    <h3>{brand.title}</h3>
                    <p>{brand.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="enterprise-section-head second-head">
              <span>✦ CHAFADIA GLOBAL GROUP FAMILY ✦</span>
              <h2>Other Brands Under Chafadia Global Group</h2>
              <p>
                Chafadia Enterprise belongs to a wider ecosystem of brands and
                institutions created for business, technology, security,
                education, family, women empowerment and social impact.
              </p>
            </div>

            <div className="global-brand-grid">
              {globalBrands.map((brand) => (
                <div className="brand-card global-brand-card" key={brand.title}>
                  <div className="brand-logo-frame">
                    <img src={brand.logo} alt={brand.title} />
                  </div>

                  <div className="brand-card-body">
                    <span>{brand.label}</span>
                    <h3>{brand.title}</h3>
                    <p>{brand.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <style>{`
        .enterprise-hero {
          align-items: flex-start !important;
          padding-top: clamp(58px, 7vh, 82px) !important;
          padding-bottom: clamp(48px, 8vh, 76px) !important;
          min-height: 86vh !important;
        }

        .enterprise-hero-card {
          max-width: 790px;
          width: 100%;
          margin: clamp(6px, 1.6vh, 18px) auto 0;
          position: relative;
          z-index: 3;
          padding: clamp(22px, 3vw, 36px);
          border-radius: 36px;
          text-align: center;
          background:
            radial-gradient(circle at top right, rgba(212, 175, 55, 0.16), transparent 34%),
            linear-gradient(135deg, rgba(5, 20, 48, 0.48), rgba(255, 255, 255, 0.10));
          border: 1px solid rgba(255, 255, 255, 0.30);
          -webkit-backdrop-filter: blur(8px);
          backdrop-filter: blur(8px);
          box-shadow:
            0 34px 86px rgba(0, 0, 0, 0.27),
            0 0 68px rgba(212, 175, 55, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }

        .enterprise-logo-wrap {
          display: grid;
          place-items: center;
          margin-bottom: 15px;
        }

        .enterprise-logo-wrap span {
          margin-top: 18px;
          padding: 7px 14px;
          border-radius: 999px;
          background: rgba(212, 175, 55, 0.17);
          border: 1px solid rgba(212, 175, 55, 0.48);
          color: var(--soft-gold, #fff3c4);
          font-size: 8.6px;
          font-weight: 1000;
          letter-spacing: 1.35px;
          text-transform: uppercase;
        }

        .enterprise-logo-orbit {
          width: clamp(80px, 9vw, 108px);
          height: clamp(80px, 9vw, 108px);
          display: grid;
          place-items: center;
          position: relative;
          border-radius: 30px;
          padding: 7px;
          background:
            radial-gradient(circle at 30% 20%, rgba(255, 247, 214, 0.95), transparent 55%),
            linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(255, 247, 214, 0.88));
          border: 1px solid rgba(212, 175, 55, 0.68);
          box-shadow:
            0 20px 54px rgba(0, 0, 0, 0.27),
            0 0 0 7px rgba(212, 175, 55, 0.10),
            0 0 52px rgba(212, 175, 55, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.85);
        }

        .enterprise-logo-orbit::before {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 38px;
          border: 1px solid rgba(212, 175, 55, 0.28);
          background: linear-gradient(135deg, rgba(212, 175, 55, 0.13), transparent);
          z-index: -1;
        }

        .enterprise-logo-orbit::after {
          content: "";
          position: absolute;
          width: 66%;
          height: 2px;
          bottom: -11px;
          left: 50%;
          transform: translateX(-50%);
          border-radius: 999px;
          background: linear-gradient(90deg, transparent, #d4af37, #fff7d6, #d4af37, transparent);
        }

        .enterprise-logo-orbit img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 23px;
        }

        .enterprise-hero-card h1 {
          color: #ffffff;
          font-size: clamp(32px, 5vw, 58px);
          font-weight: 1000;
          line-height: 0.98;
          letter-spacing: -1.35px;
          white-space: nowrap;
          text-shadow: 0 20px 50px rgba(0, 0, 0, 0.52);
        }

        .enterprise-hero-card h1 .gold {
          background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b, #fff8d9);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        .enterprise-hero-card h2 {
          display: inline-flex;
          margin-top: 14px;
          padding: 7px 17px;
          border-radius: 999px;
          background: rgba(255, 243, 196, 0.12);
          border: 1px solid rgba(212, 175, 55, 0.42);
          color: var(--soft-gold, #fff3c4);
          font-size: clamp(9.5px, 1vw, 12px);
          font-weight: 1000;
          letter-spacing: 1.9px;
          text-transform: uppercase;
        }

        .enterprise-hero-card p {
          max-width: 650px;
          margin: 17px auto 0;
          color: rgba(255, 255, 255, 0.96);
          font-size: 14.8px;
          line-height: 1.66;
          font-weight: 620;
        }

        .enterprise-buttons {
          margin-top: 23px !important;
          gap: 12px !important;
        }

        .enterprise-buttons a {
          min-height: 43px !important;
          padding: 0 21px !important;
          font-size: 13px !important;
        }

        .enterprise-premium-section {
          padding-top: 78px;
          padding-bottom: 95px;
          background:
            radial-gradient(circle at 8% 12%, rgba(212, 175, 55, 0.12), transparent 28%),
            radial-gradient(circle at 92% 18%, rgba(0, 74, 173, 0.09), transparent 30%),
            linear-gradient(135deg, #ffffff, #f8fbff);
        }

        .enterprise-section-head {
          text-align: center;
          max-width: 930px;
          margin: 0 auto 38px;
        }

        .enterprise-section-head span {
          display: inline-flex;
          margin-bottom: 13px;
          padding: 9px 17px;
          border-radius: 999px;
          background: linear-gradient(135deg, #fff7d6, #ffffff);
          color: #001f4d;
          border: 1px solid rgba(212, 175, 55, 0.44);
          font-size: 10.5px;
          font-weight: 1000;
          letter-spacing: 1.45px;
          text-transform: uppercase;
          box-shadow: 0 12px 28px rgba(212, 175, 55, 0.11);
        }

        .enterprise-section-head h2 {
          color: #001f4d;
          font-size: clamp(30px, 5vw, 54px);
          font-weight: 1000;
          letter-spacing: -1.1px;
          margin-bottom: 13px;
        }

        .enterprise-section-head p {
          color: #667085;
          line-height: 1.78;
          font-weight: 680;
        }

        .second-head {
          margin-top: 70px;
        }

        .enterprise-highlight-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 34px;
        }

        .enterprise-highlight-card,
        .enterprise-master-card,
        .brand-card,
        .architecture-parent,
        .architecture-enterprise {
          position: relative;
          overflow: hidden;
          border-radius: 30px;
          background:
            radial-gradient(circle at 95% 0%, rgba(212, 175, 55, 0.15), transparent 36%),
            radial-gradient(circle at 0% 100%, rgba(0, 74, 173, 0.08), transparent 34%),
            linear-gradient(145deg, #ffffff, #f8fbff);
          border: 1px solid rgba(212, 175, 55, 0.22);
          box-shadow:
            0 24px 58px rgba(0, 31, 77, 0.11),
            0 0 44px rgba(212, 175, 55, 0.07);
          transition: 0.38s ease;
        }

        .enterprise-highlight-card:hover,
        .enterprise-master-card:hover,
        .brand-card:hover,
        .architecture-parent:hover,
        .architecture-enterprise:hover {
          transform: translateY(-8px);
          box-shadow:
            0 34px 78px rgba(0, 31, 77, 0.16),
            0 0 62px rgba(212, 175, 55, 0.12);
        }

        .enterprise-highlight-card {
          min-height: 190px;
          padding: 24px;
        }

        .enterprise-highlight-card::before,
        .enterprise-master-card::before,
        .brand-card::before,
        .architecture-parent::before,
        .architecture-enterprise::before {
          content: "";
          position: absolute;
          top: 0;
          left: 20px;
          right: 20px;
          height: 5px;
          border-radius: 0 0 999px 999px;
          background: linear-gradient(90deg, #004aad, #d4af37, #fff7d6, #d4af37);
        }

        .enterprise-highlight-card strong {
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          border-radius: 17px;
          margin-bottom: 16px;
          background: linear-gradient(135deg, #004aad, #001f4d);
          color: #d4af37;
          font-weight: 1000;
          box-shadow: 0 14px 30px rgba(0, 31, 77, 0.14);
        }

        .enterprise-highlight-card h3 {
          color: #001f4d;
          font-size: 19px;
          font-weight: 1000;
          margin-bottom: 9px;
        }

        .enterprise-highlight-card p {
          color: #667085;
          line-height: 1.65;
          font-weight: 650;
          font-size: 14px;
        }

        .brand-architecture {
          max-width: 1060px;
          margin: 0 auto;
          padding: 22px;
          border-radius: 34px;
          background:
            linear-gradient(135deg, rgba(0, 74, 173, 0.05), rgba(212, 175, 55, 0.09));
          border: 1px solid rgba(212, 175, 55, 0.21);
        }

        .architecture-parent,
        .architecture-enterprise {
          display: grid;
          grid-template-columns: 92px 1fr;
          align-items: center;
          gap: 18px;
          padding: 21px;
        }

        .architecture-parent img,
        .architecture-enterprise img {
          width: 82px;
          height: 82px;
          object-fit: contain;
          border-radius: 24px;
          padding: 7px;
          background: #ffffff;
          border: 1px solid rgba(212, 175, 55, 0.38);
          box-shadow: 0 14px 30px rgba(0, 31, 77, 0.11);
        }

        .architecture-parent span,
        .architecture-enterprise span,
        .enterprise-master-content span,
        .brand-card-body span {
          display: inline-flex;
          width: fit-content;
          margin-bottom: 8px;
          padding: 6px 11px;
          border-radius: 999px;
          background: #fff7d6;
          color: #001f4d;
          border: 1px solid rgba(212, 175, 55, 0.34);
          font-size: 9.5px;
          font-weight: 1000;
          letter-spacing: 0.85px;
          text-transform: uppercase;
        }

        .architecture-parent h3,
        .architecture-enterprise h3,
        .enterprise-master-content h3 {
          color: #001f4d;
          font-size: 23px;
          font-weight: 1000;
          margin-bottom: 7px;
        }

        .architecture-parent p,
        .architecture-enterprise p,
        .enterprise-master-content p {
          color: #667085;
          line-height: 1.68;
          font-weight: 650;
          font-size: 14px;
        }

        .architecture-line {
          width: 3px;
          height: 36px;
          margin: 0 auto;
          background: linear-gradient(#d4af37, #004aad);
          border-radius: 999px;
        }

        .enterprise-master-card {
          max-width: 1000px;
          margin: 0 auto 26px;
          display: grid;
          grid-template-columns: 128px 1fr;
          align-items: center;
          gap: 22px;
          padding: 24px;
        }

        .enterprise-master-logo {
          width: 112px;
          height: 112px;
          display: grid;
          place-items: center;
          border-radius: 28px;
          padding: 8px;
          background: linear-gradient(135deg, #ffffff, #fff7d6);
          border: 1px solid rgba(212, 175, 55, 0.45);
          box-shadow: 0 16px 34px rgba(0, 31, 77, 0.12);
        }

        .enterprise-master-logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 22px;
        }

        .enterprise-brand-grid,
        .global-brand-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
        }

        .brand-card {
          min-height: 265px;
          padding: 20px;
        }

        .brand-logo-frame {
          width: 78px;
          height: 78px;
          display: grid;
          place-items: center;
          border-radius: 24px;
          margin-bottom: 16px;
          padding: 6px;
          background: linear-gradient(135deg, #ffffff, #fff7d6);
          border: 1px solid rgba(212, 175, 55, 0.42);
          box-shadow:
            0 15px 32px rgba(0, 31, 77, 0.12),
            0 0 0 6px rgba(212, 175, 55, 0.055);
        }

        .brand-logo-frame img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          border-radius: 18px;
        }

        .brand-card-body {
          position: relative;
          z-index: 2;
        }

        .brand-card-body h3 {
          color: #001f4d;
          font-size: 17px;
          font-weight: 1000;
          margin-bottom: 8px;
        }

        .brand-card-body p {
          color: #667085;
          line-height: 1.6;
          font-weight: 650;
          font-size: 13.5px;
        }

        @media (max-width: 1180px) {
          .enterprise-brand-grid,
          .global-brand-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 980px) {
          .enterprise-highlight-grid,
          .enterprise-brand-grid,
          .global-brand-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .enterprise-hero-card h1 {
            white-space: normal;
          }
        }

        @media (max-width: 768px) {
          .enterprise-hero {
            align-items: flex-start !important;
            padding-top: 50px !important;
          }

          .enterprise-hero-card {
            max-width: 94%;
            padding: 22px 16px;
            margin-top: 6px;
          }

          .enterprise-hero-card h1 {
            font-size: clamp(30px, 12vw, 46px);
          }

          .enterprise-logo-orbit {
            width: 82px;
            height: 82px;
            border-radius: 27px;
          }

          .enterprise-logo-orbit img {
            border-radius: 22px;
          }

          .enterprise-logo-wrap span {
            font-size: 7.6px;
            letter-spacing: 0.75px;
          }

          .enterprise-highlight-grid,
          .enterprise-brand-grid,
          .global-brand-grid {
            grid-template-columns: 1fr;
          }

          .architecture-parent,
          .architecture-enterprise,
          .enterprise-master-card {
            grid-template-columns: 1fr;
            text-align: center;
            justify-items: center;
          }

          .architecture-parent span,
          .architecture-enterprise span,
          .enterprise-master-content span {
            margin-left: auto;
            margin-right: auto;
          }

          .brand-card,
          .enterprise-highlight-card {
            min-height: auto;
            padding: 20px;
          }

          .brand-logo-frame {
            width: 74px;
            height: 74px;
          }

          .second-head {
            margin-top: 54px;
          }
        }
      `}</style>
    </>
  );
}

export default Home;
