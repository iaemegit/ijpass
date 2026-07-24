import { Link } from 'react-router-dom';
export default function Footer() { return <footer className="site-footer">
  <div className="container py-5"><div className="row g-5">
    <div className="col-lg-5"><div className="d-flex align-items-center mb-3"><span className="brand-mark brand-mark-light">IJ</span><strong className="fs-4 ms-2">IJPAss</strong></div><p className="footer-copy">Building a stronger, more transparent future for scholarly publishing through shared standards, research integrity, and global collaboration.</p><div className="socials"><a href="#"><i className="bi bi-linkedin"/></a><a href="#"><i className="bi bi-twitter-x"/></a><a href="#"><i className="bi bi-facebook"/></a></div></div>
    <div className="col-6 col-lg-2"><h6>Explore</h6><Link to="/about/ijpass">About us</Link><Link to="/aim-scope">Aim & Scope</Link><Link to="/role">Our role</Link><Link to="/contact">Contact</Link></div>
    <div className="col-6 col-lg-2"><h6>Services</h6><Link to="/membership">Membership</Link><Link to="/journal-ranking">Journal Ranking</Link><Link to="/role/publishing-excellence">Publishing Excellence</Link><Link to="/journal-ranking/directory">Directory</Link></div>
    <div className="col-lg-3"><h6>Stay informed</h6><p className="small text-white-50">News and updates from the global publishing community.</p><div className="input-group"><input className="form-control" placeholder="Email address"/><button className="btn btn-accent"><i className="bi bi-arrow-right"/></button></div></div>
  </div></div><div className="footer-bottom"><div className="container d-flex flex-wrap justify-content-between"><span>© {new Date().getFullYear()} IJPAss. All rights reserved.</span><span>Privacy Policy · Terms of Use</span></div></div>
</footer> }
