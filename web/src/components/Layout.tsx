import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/", label: "Overview", icon: "◈" },
  { to: "/signals", label: "Signals", icon: "◇" },
  { to: "/portfolio", label: "Portfolio", icon: "▦" },
  { to: "/research", label: "Research", icon: "◎" },
  { to: "/backtest", label: "Backtest", icon: "▸" },
  { to: "/system", label: "System", icon: "⚙" },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-sigil-border bg-sigil-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sigil-accent text-2xl font-black tracking-tighter">
            SIGIL
          </span>
          <span className="text-sigil-muted text-xs tracking-widest uppercase">
            v2
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
            risk_on
          </span>
          <span className="text-sigil-muted text-xs">Paper Mode</span>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="w-48 border-r border-sigil-border bg-sigil-surface py-4 flex flex-col gap-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "text-sigil-accent bg-sigil-accent/10 border-r-2 border-sigil-accent"
                    : "text-sigil-muted hover:text-sigil-text hover:bg-white/[0.03]"
                }`
              }
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
