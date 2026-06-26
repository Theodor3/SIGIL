import { NavLink, Outlet } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";

const tabs = [
  { to: "/", label: "Overview", icon: "◈" },
  { to: "/signals", label: "Signals", icon: "◇" },
  { to: "/data", label: "Data", icon: "⬡" },
  { to: "/portfolio", label: "Portfolio", icon: "▦" },
  { to: "/research", label: "Research", icon: "◎" },
  { to: "/backtest", label: "Backtest", icon: "▸" },
  { to: "/system", label: "System", icon: "⚙" },
];

export default function Layout() {
  const { connected, lastMessage } = useWebSocket();
  const pipelineRunning = lastMessage?.event === "pipeline_status";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-sigil-border bg-sigil-surface px-4 md:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sigil-accent text-2xl font-black tracking-tighter">
            SIGIL
          </span>
          <span className="text-sigil-muted text-xs tracking-widest uppercase hidden sm:inline">
            v2
          </span>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {pipelineRunning && (
            <span className="flex items-center gap-1.5 text-xs text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              <span className="hidden sm:inline">Pipeline running</span>
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full text-xs border border-sigil-accent/30 text-sigil-accent bg-sigil-accent/10">
            risk_on
          </span>
          <span className="text-sigil-muted text-xs hidden sm:inline">Paper Mode</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-sigil-accent" : "bg-sigil-danger"}`}
            title={connected ? "WebSocket connected" : "WebSocket disconnected"}
          />
        </div>
      </header>

      <div className="flex flex-1 pb-14 md:pb-0">
        {/* Desktop sidebar */}
        <nav className="hidden md:flex w-48 border-r border-sigil-border bg-sigil-surface py-4 flex-col gap-1">
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

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-sigil-border bg-sigil-surface flex justify-around z-50">
        {tabs.slice(0, 5).map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center py-2 px-1 text-[10px] transition-colors flex-1 ${
                isActive
                  ? "text-sigil-accent"
                  : "text-sigil-muted"
              }`
            }
          >
            <span className="text-lg">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
        <NavLink
          to="/system"
          className={({ isActive }) =>
            `flex flex-col items-center py-2 px-1 text-[10px] transition-colors flex-1 ${
              isActive ? "text-sigil-accent" : "text-sigil-muted"
            }`
          }
        >
          <span className="text-lg">⚙</span>
          More
        </NavLink>
      </nav>
    </div>
  );
}
