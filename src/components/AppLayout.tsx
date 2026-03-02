import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Users, History, LogOut, GitBranch, ListChecks, ChevronsLeft, ChevronsRight, Search, Settings, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import ThemeSwitcher, { applyTheme, getStoredTheme } from "./ThemeSwitcher";
import PwaInstallPrompt from "./PwaInstallPrompt";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/actions", icon: ListChecks, label: "Daily Actions" },
  { to: "/pipeline", icon: GitBranch, label: "Pipeline" },
  { to: "/contacts", icon: Users, label: "Contacts" },
  { to: "/history", icon: History, label: "Analytics" },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { applyTheme(getStoredTheme()); }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/80 backdrop-blur-sm md:hidden safe-area-bottom">
        <nav className="flex items-center justify-around py-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 min-h-[44px] min-w-[44px] text-[10px] transition-colors rounded-md touch-target",
                  isActive ? "text-foreground font-medium" : "text-muted-foreground"
                )
              }
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Desktop Notion-style sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 hidden h-full border-r border-border bg-[hsl(var(--sidebar-background))] md:flex flex-col transition-all duration-200 z-40",
          collapsed ? "w-[52px]" : "w-[240px]"
        )}
      >
        {/* Workspace header */}
        <div className="flex items-center justify-between px-3 py-3 min-h-[52px]">
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-[11px] font-bold shrink-0">
                R
              </div>
              <span className="text-sm font-semibold text-foreground truncate">ReachMate</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-[hsl(var(--sidebar-accent))] text-muted-foreground transition-colors"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Quick actions */}
        {!collapsed && (
          <div className="px-2 pb-2">
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-[hsl(var(--sidebar-accent))] transition-colors">
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
              <kbd className="ml-auto rounded bg-[hsl(var(--sidebar-accent))] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-[6px] text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-[hsl(var(--sidebar-accent))] text-foreground"
                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]",
                  collapsed && "justify-center px-0"
                )
              }
              title={collapsed ? label : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-2 pb-3 space-y-0.5">
          <ThemeSwitcher collapsed={collapsed} />
          <button
            onClick={handleLogout}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-[6px] text-[13px] font-medium text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] transition-colors",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "Logout" : undefined}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 pb-20 md:pb-0 transition-all duration-200",
          collapsed ? "md:pl-[52px]" : "md:pl-[240px]"
        )}
      >
        <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-10 md:py-6 overflow-x-hidden">{children}</div>
      </main>

      <PwaInstallPrompt />
    </div>
  );
};

export default AppLayout;
