import { NavLink, Outlet } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";
import NavIcon, { type NavIconName } from "./NavIcon";

const tabs: { to: string; label: string; icon: NavIconName }[] = [
  { to: "/", label: "Stock ideas", icon: "ideas" },
  { to: "/experiments", label: "Studies", icon: "studies" },
  { to: "/performance", label: "Results", icon: "results" },
  { to: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { to: "/system", label: "System", icon: "system" },
  { to: "/research", label: "Company research", icon: "research" },
  { to: "/overview", label: "Previous overview", icon: "overview" },
  { to: "/signals", label: "Signals", icon: "signals" },
  { to: "/data", label: "Source health", icon: "sources" },
  { to: "/compare", label: "Compare", icon: "compare" },
  { to: "/lab", label: "Lab", icon: "lab" },
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
          <span className="text-sigil-muted text-xs hidden sm:inline">Research dashboard</span>
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
              <NavIcon name={tab.icon} className="w-[18px] h-[18px]" />
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
        {tabs.slice(0, 4).map((tab) => (
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
            <NavIcon name={tab.icon} className="w-5 h-5 mb-0.5" />
            {tab.label}
          </NavLink>
        ))}
        <details className="relative flex-1 group">
          <summary className="flex flex-col items-center py-2 px-1 text-[10px] text-sigil-muted cursor-pointer list-none">
            <NavIcon name="more" className="w-5 h-5 mb-0.5" />More
          </summary>
          <div className="absolute bottom-full right-0 mb-2 w-48 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-xl border border-sigil-border bg-sigil-surface shadow-xl p-2">
            {tabs.slice(4).map(tab => <NavLink key={tab.to} to={tab.to}
              onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}
              className={({isActive}) => `flex items-center gap-3 px-3 py-3 rounded-lg text-sm ${isActive ? "text-sigil-accent bg-sigil-accent/10" : "text-sigil-text"}`}>
              <NavIcon name={tab.icon} className="w-[18px] h-[18px]" />{tab.label}
            </NavLink>)}
          </div>
        </details>
      </nav>
    </div>
  );
}
