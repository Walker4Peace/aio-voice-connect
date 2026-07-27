import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { AppLayout } from '@/components/layout/app-layout';

import Dashboard from '@/pages/dashboard';
import ClientsList from '@/pages/clients/index';
import ClientDetail from '@/pages/clients/detail';
import ExtensionsList from '@/pages/extensions/index';
import ExtensionDetail from '@/pages/extensions/detail';
import AgentConfigsList from '@/pages/agent-configs/index';
import AgentConfigForm from '@/pages/agent-configs/form';
import LogsPage from '@/pages/logs/index';
import CallsPage from '@/pages/calls/index';
import SetupWizard from '@/pages/setup/index';
import LoginPage from '@/pages/login/index';
import { Loader2 } from 'lucide-react';

// i18n — must be imported before any component that uses useTranslation
import '@/lib/i18n';
import i18n from '@/lib/i18n';
import { useEffect } from 'react';

function NotFound() {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center space-y-4">
      <h1 className="text-4xl font-bold tracking-tight text-destructive">404</h1>
      <p className="text-muted-foreground">This page could not be found.</p>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

/** Syncs the i18next language whenever the logged-in user's preference changes. */
function LanguageSync() {
  const { user } = useAuth();
  useEffect(() => {
    const lang = user?.language ?? 'en';
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang);
    }
  }, [user?.language]);
  return null;
}

function AppRoutes() {
  const { isLoading, setupComplete, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!setupComplete) return <SetupWizard />;
  if (!user) return <LoginPage />;

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/ipbxs" component={ClientsList} />
        <Route path="/ipbxs/:id" component={ClientDetail} />
        <Route path="/extensions" component={ExtensionsList} />
        <Route path="/extensions/:id" component={ExtensionDetail} />
        <Route path="/agent-configs" component={AgentConfigsList} />
        <Route path="/agent-configs/new" component={AgentConfigForm} />
        <Route path="/agent-configs/:id/edit" component={AgentConfigForm} />
        <Route path="/calls" component={CallsPage} />
        <Route path="/logs" component={LogsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <LanguageSync />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
