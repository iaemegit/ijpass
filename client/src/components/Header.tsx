import { Link, NavLink } from 'react-router-dom';
import { navigation } from '../data/navigation';

export default function Header() {
  return <>
    <div className="utility-bar"><div className="container d-flex justify-content-between align-items-center">
      <span><i className="bi bi-globe2 me-2"/>Connecting scholarly publishers worldwide</span>
      <div className="d-flex gap-3"><a href="mailto:info@ijpass.com"><i className="bi bi-envelope me-1"/>info@ijpass.com</a><Link to="/admin/login"><i className="bi bi-person-lock me-1"/>Portal Login</Link></div>
    </div></div>
    <nav className="navbar navbar-expand-xxl navbar-light bg-white sticky-top shadow-sm">
      <div className="container"><Link className="navbar-brand d-flex align-items-center" to="/">
        <span className="brand-mark">IJ</span><span className="brand-title"><b>International Journal</b><small>Publishers Association <strong>(IJPAss)</strong></small></span>
      </Link><button className="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav"><span className="navbar-toggler-icon"/></button>
      <div className="collapse navbar-collapse" id="mainNav"><ul className="navbar-nav ms-auto align-items-xl-center">
        {navigation.map(item => item.children ? <li className="nav-item dropdown" key={item.path}>
          <NavLink className="nav-link dropdown-toggle" to={item.path} data-bs-toggle="dropdown">{item.label}</NavLink>
          <ul className="dropdown-menu">{item.children.map(c => <li key={c.path}><NavLink className="dropdown-item" to={c.path}>{c.label}</NavLink></li>)}</ul>
        </li> : <li className="nav-item" key={item.path}><NavLink className="nav-link" to={item.path}>{item.label}</NavLink></li>)}
      </ul></div></div>
    </nav>
  </>;
}
