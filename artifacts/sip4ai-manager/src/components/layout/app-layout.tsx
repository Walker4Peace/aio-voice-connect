import React from "react";
import { Link, useLocation } from "wouter";
import { Server, Users, Phone, Settings, Menu, Activity, FileTerminal, Bot, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Dashboard", href: "/", icon: Activity },
  { name: "IPBXs", href: "/ipbxs", icon: Server },
  { name: "AI Agents", href: "/agent-configs", icon: Bot },
  { name: "Extensions", href: "/extensions", icon: Users },
  { name: "Call History", href: "/calls", icon: PhoneCall },
  { name: "Logs", href: "/logs", icon: FileTerminal },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile sidebar backdrop */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 px-6">
          <img src="/logo.png" alt="SIP Agent" className="h-8 w-auto object-contain" />
          <span className="text-lg font-bold tracking-tight">SIP Agent</span>
        </div>

        <nav className="mt-6 flex flex-col gap-1 px-3">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>
        
        <div className="absolute bottom-4 left-0 right-0 px-6">
          <div className="flex items-center gap-3 rounded-md bg-sidebar-accent/50 p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary/20 text-sidebar-primary">
              <Settings className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-sidebar-foreground">AIO PROCESS</span>
              <span className="text-[10px] text-sidebar-foreground/50">v1.0.0</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="SIP Agent" className="h-8 w-auto object-contain" />
            <span className="text-lg font-bold">SIP Agent</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="h-6 w-6" />
          </Button>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
