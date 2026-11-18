import Link from "next/link";
import { REGISTER_PATH } from "@/lib/register";
import { AccountMenu } from "./AccountMenu";
import { Brand, Icon } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "New assessment", icon: "plus" },
  { href: REGISTER_PATH, label: "My assessments", icon: "register" },
] as const;

export function RegisterShell({ email, section, parent, current, title, intro, children }: {
  /** Absent while the page is still loading. */
  email?: string;
  section: string;
  /** Where this page sits in the register, shown as a breadcrumb before the section. */
  parent?: { href: string; label: string };
  current?: (typeof NAV)[number]["href"];
  title: React.ReactNode;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <a className="skip-link" href="#register">Skip to the content</a>
      <aside className="sidebar" aria-label="Main">
        <Brand />
        <nav aria-label="Main">
          <ul className="nav-list">
            {NAV.map(({ href, label, icon }) => (
              <li key={href}>
                <Link href={href} aria-current={href === current ? "page" : undefined}><Icon name={icon} />{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main className="main-area" id="top">
        <div className="topbar">
          <Icon name="register" size={18} />
          {parent
            ? <nav className="breadcrumbs" aria-label="Breadcrumbs">
                <ol><li><Link href={parent.href}>{parent.label}</Link></li><li aria-current="page">{section}</li></ol>
              </nav>
            : <b>{section}</b>}
          <ThemeToggle />
          {email && <AccountMenu email={email} />}
        </div>
        <header className="page-header">
          <div>
            <h1>{title}</h1>
            {intro && <p>{intro}</p>}
          </div>
        </header>
        <section className="workspace" id="register">{children}</section>
        <footer>Decision support, not legal advice.</footer>
      </main>
    </div>
  );
}
