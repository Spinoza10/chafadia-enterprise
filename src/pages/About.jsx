import Navbar from "../components/Navbar";

import heroImage from "../assets/images/home-page4.png";

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

function About() {
  const enterprisePortfolio = [
    {
      logo: feminineLogo,
      title: "Chafadia Feminine Secrets",
      label: "Fashion • Beauty • Women Essentials",
      text: "A refined lifestyle brand for modest fashion, perfumes, body care, hijabs, accessories and women essentials.",
    },
    {
      logo: botanicalsLogo,
      title: "Chafadia Botanicals",
      label: "Natural Care • Wellness",
      text: "A wellness-focused brand offering botanical products, family care essentials and natural lifestyle solutions.",
    },
    {
      logo: cripsLogo,
      title: "Chafadia Crips Co.",
      label: "Premium Snacks",
      text: "A snack brand created for banana, potato, beef and chicken chips with beautiful packaging and quality taste.",
    },
    {
      logo: drinksLogo,
      title: "Chafadia Halal Drinks",
      label: "Fresh • Natural • Halal",
      text: "A halal beverage brand for juices, zobo, yogurt drinks, cocktails and refreshing drinks prepared with care.",
    },
    {
      logo: premiumProductsLogo,
      title: "Chafadia Premium Products",
      label: "Lifestyle • Hygiene • Care",
      text: "A premium product line for beauty, hygiene, cleanliness, family care and everyday lifestyle essentials.",
    },
  ];

  const globalGroupBrands = [
    {
      logo: globalLogo,
      title: "our parent organization",
      label: "Parent Organization",
      text: "The parent vision connecting all Chafadia brands, institutions, businesses and impact initiatives.",
    },
    {
      logo: enterpriseLogo,
      title: "Chafadia Enterprise",
      label: "Featured Application Brand",
      text: "The premium commerce and lifestyle-products brand featured in this application.",
    },
    {
      logo: techEmpireLogo,
      title: "Chafadia Tech Empire",
      label: "Technology & Digital Innovation",
      text: "Technology services for web development, mobile applications, systems and modern digital solutions.",
    },
    {
      logo: cybersecurityLogo,
      title: "Chafadia Cybersecurity",
      label: "Security • Awareness • Protection",
      text: "Cybersecurity services, ethical hacking, awareness and digital protection solutions.",
    },
    {
      logo: consultationLogo,
      title: "Chafadia Consultation",
      label: "Strategy • Writing • Guidance",
      text: "Consultation for project drafting, business planning, professional writing and enterprise guidance.",
    },
    {
      logo: foundationLogo,
      title: "Chafadia Foundation",
      label: "Humanity • Support • Impact",
      text: "A social impact institution created for community support, education, care and meaningful assistance.",
    },
    {
      logo: familyWomenLogo,
      title: "Chafadia Women & Family",
      label: "Family • Care • Guidance",
      text: "A family-focused platform supporting women, homes, marriage education, intimacy guidance and wellbeing.",
    },
    {
      logo: familyWomenLogo,
      title: "Chafadia Women Empowerment",
      label: "Women • Skills • Confidence",
      text: "An empowerment initiative for women, girls, education, skills, confidence and personal development.",
    },
    {
      logo: academyLogo,
      title: "Chafadia Academy",
      label: "Education • Training • Growth",
      text: "An academy for learning, courses, training, mentorship and professional development.",
    },
  ];

  const values = [
    "Premium Quality",
    "Customer Happiness",
    "Trust & Integrity",
    "Faith-Inspired Purpose",
    "Innovation & Excellence",
    "Family & Community Care",
  ];

  return (
    <>
      <Navbar />

      <div className="about-page">
        <style>{`
          .about-page {
            min-height: 100vh;
            padding: 30px;
            background:
              radial-gradient(circle at 8% 8%, rgba(212, 175, 55, 0.22), transparent 28%),
              radial-gradient(circle at 90% 12%, rgba(0, 74, 173, 0.16), transparent 30%),
              linear-gradient(135deg, #f6f8ff 0%, #ffffff 52%, #f7f9ff 100%);
          }

          .about-container {
            max-width: 1360px;
            margin: 0 auto;
          }

          .about-hero-premium {
            position: relative;
            overflow: hidden;
            min-height: 445px;
            border-radius: 46px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 260px;
            align-items: center;
            gap: 34px;
            padding: 46px;
            margin-bottom: 26px;
            background-image:
              linear-gradient(135deg, rgba(0, 31, 77, 0.88), rgba(0, 74, 173, 0.58), rgba(0, 31, 77, 0.82)),
              url(${heroImage});
            background-size: cover;
            background-position: center;
            border: 1px solid rgba(212, 175, 55, 0.5);
            box-shadow:
              0 38px 100px rgba(0, 31, 77, 0.29),
              inset 0 1px 0 rgba(255,255,255,0.16);
          }

          .about-hero-premium::before {
            content: "";
            position: absolute;
            width: 410px;
            height: 410px;
            right: -165px;
            top: -165px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(212,175,55,0.44), transparent 68%);
          }

          .about-hero-premium::after {
            content: "";
            position: absolute;
            inset: 18px;
            border-radius: 36px;
            border: 1px solid rgba(255,255,255,0.18);
            pointer-events: none;
          }

          .about-hero-content,
          .hero-logo-panel {
            position: relative;
            z-index: 2;
          }

          .about-label {
            display: inline-flex;
            padding: 9px 17px;
            border-radius: 999px;
            margin-bottom: 18px;
            background: rgba(212, 175, 55, 0.18);
            color: #fff7d6;
            border: 1px solid rgba(212, 175, 55, 0.45);
            font-size: 12px;
            font-weight: 950;
            letter-spacing: 0.9px;
            text-transform: uppercase;
            backdrop-filter: blur(8px);
          }

          .about-hero-content h1 {
            color: #ffffff;
            font-size: clamp(38px, 6vw, 72px);
            line-height: 1.02;
            font-weight: 1000;
            letter-spacing: -1.9px;
            margin-bottom: 16px;
          }

          .about-hero-content h1 span {
            background: linear-gradient(135deg, #fff7d6, #d4af37, #b8860b);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
          }

          .about-hero-content p {
            color: rgba(255,255,255,0.92);
            max-width: 850px;
            line-height: 1.84;
            font-weight: 650;
            font-size: 16px;
          }

          .hero-logo-panel {
            display: grid;
            place-items: center;
            padding: 24px;
            border-radius: 34px;
            background:
              radial-gradient(circle at top right, rgba(212,175,55,0.24), transparent 34%),
              rgba(255,255,255,0.10);
            border: 1px solid rgba(255,255,255,0.22);
            backdrop-filter: blur(10px);
            box-shadow: 0 24px 60px rgba(0,0,0,0.20);
          }

          .hero-logo-frame {
            width: 160px;
            height: 160px;
            display: grid;
            place-items: center;
            padding: 10px;
            border-radius: 38px;
            background: linear-gradient(135deg, #ffffff, #fff7d6);
            border: 1px solid rgba(212,175,55,0.56);
            box-shadow:
              0 18px 45px rgba(0,0,0,0.24),
              0 0 0 8px rgba(212,175,55,0.10);
          }

          .hero-logo-frame img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            border-radius: 28px;
          }

          .hero-logo-panel span {
            display: inline-flex;
            margin-top: 17px;
            padding: 8px 13px;
            border-radius: 999px;
            background: rgba(212,175,55,0.18);
            color: #fff7d6;
            border: 1px solid rgba(212,175,55,0.38);
            font-size: 10px;
            font-weight: 1000;
            letter-spacing: 1px;
            text-transform: uppercase;
            text-align: center;
          }

          .hero-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 24px;
          }

          .hero-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 11px 15px;
            border-radius: 999px;
            background: rgba(255,255,255,0.1);
            color: #ffffff;
            border: 1px solid rgba(255,255,255,0.22);
            backdrop-filter: blur(8px);
            font-weight: 900;
            font-size: 12px;
          }

          .about-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 15px;
            margin-bottom: 26px;
          }

          .stat-card,
          .global-card,
          .brand-card,
          .enterprise-showcase,
          .about-card,
          .worldwide-card,
          .world-map-card,
          .values-strip {
            position: relative;
            overflow: hidden;
            background:
              radial-gradient(circle at top right, rgba(212,175,55,0.16), transparent 34%),
              linear-gradient(145deg, #ffffff, #f8fbff);
            border: 1px solid rgba(212,175,55,0.22);
            border-radius: 28px;
            box-shadow: 0 18px 46px rgba(0,31,77,0.10);
            transition: 0.34s ease;
          }

          .stat-card:hover,
          .global-card:hover,
          .brand-card:hover,
          .enterprise-showcase:hover,
          .about-card:hover,
          .worldwide-card:hover,
          .world-map-card:hover {
            transform: translateY(-7px);
            box-shadow: 0 30px 70px rgba(0,31,77,0.16);
          }

          .stat-card {
            padding: 18px;
          }

          .stat-card::after,
          .global-card::after,
          .brand-card::after {
            content: "";
            position: absolute;
            width: 110px;
            height: 110px;
            right: -48px;
            top: -48px;
            border-radius: 50%;
            background: rgba(212,175,55,0.14);
          }

          .stat-card h3 {
            color: #667085;
            font-size: 12px;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 8px;
            font-weight: 900;
          }

          .stat-card h2 {
            color: #d4af37;
            font-size: 26px;
            font-weight: 950;
          }

          .section-heading {
            text-align: center;
            max-width: 920px;
            margin: 42px auto 22px;
          }

          .section-heading span {
            display: inline-flex;
            padding: 9px 17px;
            border-radius: 999px;
            margin-bottom: 14px;
            background: linear-gradient(135deg, #fff7d6, #ffffff);
            color: #001f4d;
            border: 1px solid rgba(212,175,55,0.42);
            font-size: 11px;
            font-weight: 1000;
            letter-spacing: 1.4px;
            text-transform: uppercase;
          }

          .section-heading h2 {
            color: #001f4d;
            font-size: clamp(30px, 5vw, 54px);
            font-weight: 1000;
            letter-spacing: -1.15px;
            margin-bottom: 12px;
          }

          .section-heading p {
            color: #667085;
            line-height: 1.78;
            font-weight: 680;
          }

          .group-intro {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(320px, 0.72fr);
            gap: 22px;
            margin: 28px 0 28px;
          }

          .global-card {
            padding: 28px;
          }

          .global-card h2 {
            color: #001f4d;
            font-size: 30px;
            font-weight: 1000;
            margin-bottom: 12px;
          }

          .global-card p {
            color: #667085;
            line-height: 1.78;
            font-weight: 660;
          }

          .global-logo-card {
            background:
              radial-gradient(circle at top right, rgba(212,175,55,0.28), transparent 34%),
              linear-gradient(135deg, #004aad, #001f4d);
            color: white;
            padding: 26px;
          }

          .global-logo-card img {
            width: 128px;
            height: 128px;
            object-fit: contain;
            padding: 9px;
            margin-bottom: 18px;
            border-radius: 30px;
            background: #ffffff;
            border: 1px solid rgba(212,175,55,0.46);
            box-shadow: 0 18px 44px rgba(0,0,0,0.18);
          }

          .global-logo-card h3 {
            color: #d4af37;
            font-size: 25px;
            font-weight: 1000;
            margin-bottom: 10px;
          }

          .global-logo-card p {
            color: rgba(255,255,255,0.88);
            line-height: 1.7;
            font-weight: 650;
          }

          .architecture-box {
            max-width: 1080px;
            margin: 0 auto 30px;
            padding: 24px;
            border-radius: 36px;
            background:
              linear-gradient(135deg, rgba(0,74,173,0.06), rgba(212,175,55,0.12));
            border: 1px solid rgba(212,175,55,0.22);
          }

          .architecture-card {
            display: grid;
            grid-template-columns: 95px 1fr;
            gap: 18px;
            align-items: center;
            padding: 20px;
            border-radius: 28px;
            background: #ffffff;
            border: 1px solid rgba(212,175,55,0.22);
            box-shadow: 0 16px 38px rgba(0,31,77,0.08);
          }

          .architecture-card img {
            width: 82px;
            height: 82px;
            object-fit: contain;
            border-radius: 23px;
            padding: 7px;
            background: #fff7d6;
            border: 1px solid rgba(212,175,55,0.38);
          }

          .architecture-card span,
          .enterprise-showcase-content span,
          .brand-card-body span {
            display: inline-flex;
            width: fit-content;
            margin-bottom: 8px;
            padding: 6px 11px;
            border-radius: 999px;
            background: #fff7d6;
            color: #001f4d;
            border: 1px solid rgba(212,175,55,0.34);
            font-size: 9.5px;
            font-weight: 1000;
            letter-spacing: 0.9px;
            text-transform: uppercase;
          }

          .architecture-card h3,
          .enterprise-showcase-content h3 {
            color: #001f4d;
            font-size: 23px;
            font-weight: 1000;
            margin-bottom: 7px;
          }

          .architecture-card p,
          .enterprise-showcase-content p {
            color: #667085;
            line-height: 1.68;
            font-weight: 650;
            font-size: 14px;
          }

          .architecture-line {
            width: 3px;
            height: 38px;
            margin: 0 auto;
            border-radius: 999px;
            background: linear-gradient(#d4af37, #004aad);
          }

          .enterprise-showcase {
            display: grid;
            grid-template-columns: 135px 1fr;
            gap: 24px;
            align-items: center;
            padding: 26px;
            margin-bottom: 26px;
          }

          .enterprise-showcase-logo {
            width: 118px;
            height: 118px;
            display: grid;
            place-items: center;
            padding: 8px;
            border-radius: 30px;
            background: linear-gradient(135deg, #ffffff, #fff7d6);
            border: 1px solid rgba(212,175,55,0.45);
            box-shadow: 0 16px 36px rgba(0,31,77,0.12);
          }

          .enterprise-showcase-logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            border-radius: 22px;
          }

          .brand-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 18px;
          }

          .enterprise-grid {
            grid-template-columns: repeat(5, 1fr);
          }

          .brand-card {
            min-height: 260px;
            padding: 20px;
          }

          .brand-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 20px;
            right: 20px;
            height: 5px;
            border-radius: 0 0 999px 999px;
            background: linear-gradient(90deg, #004aad, #d4af37, #fff7d6, #d4af37);
          }

          .brand-logo-frame {
            width: 78px;
            height: 78px;
            display: grid;
            place-items: center;
            margin-bottom: 16px;
            padding: 6px;
            border-radius: 23px;
            background: linear-gradient(135deg, #ffffff, #fff7d6);
            border: 1px solid rgba(212,175,55,0.42);
            box-shadow: 0 15px 32px rgba(0,31,77,0.12);
          }

          .brand-logo-frame img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            border-radius: 17px;
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

          .about-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 18px;
            margin-bottom: 26px;
          }

          .about-card {
            background: rgba(255,255,255,0.985);
          }

          .about-card-head {
            padding: 22px;
            background:
              linear-gradient(135deg, rgba(0,74,173,0.08), rgba(212,175,55,0.13));
            border-bottom: 1px solid rgba(0,74,173,0.08);
          }

          .about-card-head h2 {
            color: #001f4d;
            font-size: 24px;
            font-weight: 950;
          }

          .about-card-body {
            padding: 22px;
          }

          .about-card-body p {
            color: #667085;
            font-size: 14.5px;
            line-height: 1.75;
            font-weight: 650;
          }

          .worldwide-section {
            display: grid;
            grid-template-columns: minmax(0, 0.85fr) minmax(300px, 1fr);
            gap: 20px;
            margin-bottom: 26px;
            align-items: stretch;
          }

          .worldwide-card,
          .world-map-card,
          .values-strip {
            padding: 28px;
            border-radius: 32px;
          }

          .worldwide-card h2,
          .values-strip h2 {
            color: #001f4d;
            font-size: 28px;
            font-weight: 950;
            margin-bottom: 12px;
          }

          .worldwide-card p {
            color: #667085;
            font-size: 14.5px;
            line-height: 1.75;
            font-weight: 650;
          }

          .world-map-card {
            background:
              radial-gradient(circle at 20% 30%, rgba(212,175,55,0.22), transparent 25%),
              radial-gradient(circle at 75% 70%, rgba(255,255,255,0.14), transparent 25%),
              linear-gradient(135deg, #004aad, #001f4d);
            color: #ffffff;
            border: 1px solid rgba(212,175,55,0.4);
          }

          .world-map-card h3 {
            color: #d4af37;
            font-size: 25px;
            font-weight: 950;
            margin-bottom: 12px;
          }

          .world-map-card p {
            color: rgba(255,255,255,0.9);
            line-height: 1.7;
            font-weight: 650;
          }

          .delivery-points {
            display: grid;
            gap: 10px;
            margin-top: 16px;
          }

          .delivery-point {
            padding: 12px 14px;
            border-radius: 17px;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.14);
            font-weight: 800;
            color: rgba(255,255,255,0.92);
          }

          .values-list {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
          }

          .value-pill {
            padding: 10px 14px;
            border-radius: 999px;
            background: linear-gradient(135deg, #fff7d6, #d4af37);
            color: #001f4d;
            font-size: 13px;
            font-weight: 950;
          }

          @media (max-width: 1180px) {
            .brand-grid,
            .enterprise-grid {
              grid-template-columns: repeat(3, 1fr);
            }
          }

          @media (max-width: 980px) {
            .about-hero-premium,
            .group-intro,
            .worldwide-section {
              grid-template-columns: 1fr;
            }

            .hero-logo-panel {
              max-width: 300px;
            }

            .brand-grid,
            .enterprise-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }

          @media (max-width: 650px) {
            .about-page {
              padding: 14px;
            }

            .about-hero-premium {
              border-radius: 28px;
              min-height: auto;
              padding: 22px 16px;
            }

            .hero-logo-frame {
              width: 115px;
              height: 115px;
              border-radius: 28px;
            }

            .brand-grid,
            .enterprise-grid {
              grid-template-columns: 1fr;
            }

            .architecture-card,
            .enterprise-showcase {
              grid-template-columns: 1fr;
              text-align: center;
              justify-items: center;
            }

            .architecture-card span,
            .enterprise-showcase-content span {
              margin-left: auto;
              margin-right: auto;
            }

            .worldwide-card,
            .world-map-card,
            .values-strip,
            .global-card,
            .enterprise-showcase {
              border-radius: 26px;
              padding: 20px;
            }
          }
        `}</style>

        <div className="about-container">
          <section className="about-hero-premium">
            <div className="about-hero-content">
              <span className="about-label">
                Chafadia Enterprise • Where Quality Meets Purpose.
              </span>

              <h1>
                About <span>CHAFADIA ENTERPRISE</span>
              </h1>

              <p>
                CHAFADIA ENTERPRISE is a distinguished premium lifestyle brand
                operating within the Chafadia Global Group. Through a carefully
                curated portfolio of beauty, wellness, fashion, halal beverages,
                gourmet snacks, hygiene and family care products, we are committed
                to delivering exceptional quality, purposeful innovation and memorable 
                customer experiences that inspire confidence and enrich everyday life.
              </p>

              <div className="hero-badges">
                <span className="hero-badge">🌍 Under Chafadia Global Group</span>
                <span className="hero-badge">⭐ Premium Enterprise Standard</span>
                <span className="hero-badge">🤝 Customer Happiness First</span>
              </div>
            </div>

            <div className="hero-logo-panel">
              <div className="hero-logo-frame">
                <img src={enterpriseLogo} alt="Chafadia Enterprise" />
              </div>
              <span>Featured Brand Application</span>
            </div>
          </section>

          <div className="about-stats">
            <div className="stat-card">
              <h3>Parent Vision</h3>
              <h2>Global</h2>
            </div>

            <div className="stat-card">
              <h3>Enterprise Portfolio</h3>
              <h2>5+</h2>
            </div>

            <div className="stat-card">
              <h3>Brand Family</h3>
              <h2>9+</h2>
            </div>

            <div className="stat-card">
              <h3>Core Standard</h3>
              <h2>Quality</h2>
            </div>
          </div>

          <section>
            <div className="section-heading">
              <span>✦ Brand Architecture ✦</span>
              <h2>Chafadia Enterprise Within Chafadia Global Group</h2>
              <p>
                Chafadia Global Group is the parent organization for the wider
                Chafadia ecosystem. This application focuses on Chafadia
                Enterprise while professionally presenting its place within the
                group and the brands connected to it.
              </p>
            </div>

            <div className="group-intro">
              <div className="global-card">
                <h2>CHAFADIA GLOBAL GROUP</h2>
                <p>
                  Our parent organization provides the broader vision that connects
                  bringing together business, technology, cybersecurity,
                  consultation, education, foundation work, women empowerment and
                  family development under one unified vision of excellence,
                  service and lasting legacy.
                </p>
              </div>

              <div className="global-card global-logo-card">
                <img src={globalLogo} alt="Chafadia Global Group" />
                <h3>One Vision. Multiple Brands.</h3>
                <p>
                  The parent identity guiding the Chafadia family of brands,
                  institutions and impact-driven initiatives.
                </p>
              </div>
            </div>

            <div className="architecture-box">
              <div className="architecture-card">
                <img src={globalLogo} alt="Chafadia Global Group" />
                <div>
                  <span>Parent Organization</span>
                  <h3>CHAFADIA GLOBAL GROUP</h3>
                  <p>
                    The central vision connecting all Chafadia brands and
                    institutions.
                  </p>
                </div>
              </div>

              <div className="architecture-line"></div>

              <div className="architecture-card">
                <img src={enterpriseLogo} alt="Chafadia Enterprise" />
                <div>
                  <span>Featured Brand In This Application</span>
                  <h3>CHAFADIA ENTERPRISE</h3>
                  <p>
                    The premium commerce and lifestyle-products brand featured
                    in this platform.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="section-heading">
              <span>✦ Chafadia Enterprise Portfolio ✦</span>
              <h2>The Premium Product Brands of Chafadia Enterprise</h2>
              <p>
                Chafadia Enterprise brings together a carefully curated portfolio
                of specialized product brands, each serving a unique market while
                sharing one uncompromising standard of excellence, innovation
                and premium quality.
              </p>
            </div>

            <div className="enterprise-showcase">
              <div className="enterprise-showcase-logo">
                <img src={enterpriseLogo} alt="Chafadia Enterprise" />
              </div>

              <div className="enterprise-showcase-content">
                <span>Integrated Portfolio of Premium Lifestyle Brands</span>
                <h3>CHAFADIA ENTERPRISE</h3>
                <p>
                  An integrated portfolio of premium lifestyle brands
                  encompassing Chafadia Feminine Secrets, Chafadia Botanicals,
                  Chafadia Crips Co, Chafadia Halal Drinks and Chafadia Premium
                  Products working together under one trusted identity to deliver
                  excellence across every customer experience.
                </p>
              </div>
            </div>

            <div className="brand-grid enterprise-grid">
              {enterprisePortfolio.map((brand) => (
                <div className="brand-card" key={brand.title}>
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
          </section>

          <section>
            <div className="section-heading">
              <span>✦ Chafadia Global Group Family ✦</span>
              <h2>Other Brands and Institutions Within the Chafadia Ecosystem</h2>
              <p>
                Although this application focuses on Chafadia Enterprise, the
                wider Chafadia Global Group includes additional brands and
                institutions in technology, cybersecurity, consultation,
                education, women empowerment, family development and social
                impact.
              </p>
            </div>

            <div className="brand-grid">
              {globalGroupBrands.map((brand) => (
                <div className="brand-card" key={brand.title}>
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
          </section>


          <div className="about-card" style={{marginBottom:"26px"}}>
            <div className="about-card-head">
              <h2>A Brand Built on Love, Faith & Purpose</h2>
            </div>

            <div className="about-card-body">
              <p>
                <strong>CHAFADIA ENTERPRISE</strong> is a purpose-driven premium
                enterprise built on excellence, integrity and innovation. Our
                mission is to create exceptional products that inspire
                confidence, promote healthier lifestyles and enrich everyday
                living. Through an unwavering commitment to quality, customer
                satisfaction and continuous improvement, we strive to build
                lasting relationships while delivering meaningful value to
                individuals, families and businesses.
              </p>

              <p style={{marginTop:"16px"}}>
                The memory of my beloved late husband,
                <strong> Chafiou Hamidou</strong>, remains a constant source of
                strength and inspiration. His kindness, sacrifice, patience,
                encouragement and unwavering belief continue to guide this
                journey. This enterprise is dedicated to honouring that legacy
                through sincere service, honest work and excellence in every
                product and every customer experience.
              </p>

              <p style={{marginTop:"16px"}}>
                More than a business, CHAFADIA ENTERPRISE represents service,
                sincerity, premium quality, beauty, wellness, family care and
                the conviction that a brand can create both lasting value and a
                meaningful legacy for generations to come.
              </p>

              <p style={{
                marginTop:"22px",
                padding:"16px",
                borderRadius:"18px",
                background:"linear-gradient(135deg,#fff7d6,#ffffff)",
                border:"1px solid rgba(212,175,55,.35)",
                textAlign:"center",
                fontWeight:900,
                color:"#001f4d"
              }}>
                Chafiou Hamidou &amp; Sadiyatou Chafiou —
                <br/>
                <span style={{color:"#b8860b"}}>
                  A Story of Love • Remembrance • Service • Resilience • Purpose
                </span>
              </p>
            </div>
          </div>


          <div className="about-grid">
            <div className="about-card">
              <div className="about-card-head">
                <h2>Our Mission</h2>
              </div>

              <div className="about-card-body">
                <p>
                  To provide trusted, elegant and high-quality products that
                  support beauty, wellness, refreshment, modest living, hygiene,
                  clean homes and everyday family care with professionalism,
                  excellence and customer-first service.
                </p>
              </div>
            </div>

            <div className="about-card">
              <div className="about-card-head">
                <h2>Our Vision</h2>
              </div>

              <div className="about-card-body">
                <p>
                  To become a recognized premium enterprise within the Chafadia
                  Global Group family, known for quality, creativity, customer
                  satisfaction, strong branding and products that bring real
                  value to communities.
                </p>
              </div>
            </div>

            <div className="about-card">
              <div className="about-card-head">
                <h2>What We Represent</h2>
              </div>

              <div className="about-card-body">
                <p>
                  We represent resilience, faith, elegance, service, honest
                  business, innovation, customer care and the belief that a brand
                  can carry both quality products and a meaningful legacy.
                </p>
              </div>
            </div>
          </div>

          <section className="worldwide-section">
            <div className="worldwide-card">
              <h2>We Deliver Worldwide</h2>
              <p>
                Chafadia Enterprise is built with a global mindset. Whether a
                customer is in Cameroon or abroad, our goal is to make quality
                Chafadia products accessible through professional service,
                reliable communication and careful order handling.
              </p>
            </div>

            <div className="world-map-card">
              <h3>Our Delivery Promise</h3>
              <p>We care about every order because every customer matters.</p>

              <div className="delivery-points">
                <div className="delivery-point">Local delivery within Cameroon</div>
                <div className="delivery-point">Worldwide order support</div>
                <div className="delivery-point">Careful packaging and customer follow-up</div>
                <div className="delivery-point">Premium service before and after purchase</div>
              </div>
            </div>
          </section>

          <section className="values-strip">
            <h2>Our Values</h2>

            <div className="values-list">
              {values.map((value) => (
                <span className="value-pill" key={value}>
                  {value}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default About;
