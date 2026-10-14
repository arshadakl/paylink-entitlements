import React, { useState } from 'react';
import { useSessionQuery, useLogoutMutation } from './hooks/useAuth';
import { useHealth } from './hooks/useHealth';
import { LoginForm } from './components/LoginForm';
import { DashboardMetrics } from './components/DashboardMetrics';
import { ProductsView } from './components/ProductsView';
import { PaymentsView } from './components/PaymentsView';
import { GrantsView } from './components/GrantsView';
import { WebhookEventsView } from './components/WebhookEventsView';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Layers,
  Server,
  RefreshCw,
  LogOut,
  ShoppingBag,
  CreditCard,
  ShieldCheck,
  Radio,
  Cpu,
  User,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

type TabKey = 'products' | 'payments' | 'grants' | 'webhooks' | 'system';

export const App: React.FC = () => {
  const { data: session, isLoading: isSessionLoading } = useSessionQuery();
  const logoutMutation = useLogoutMutation();
  const [activeTab, setActiveTab] = useState<TabKey>('products');

  // Health data for system tab
  const {
    data: health,
    isLoading: isHealthLoading,
    isError: isHealthError,
    error: healthError,
    isFetching: isHealthFetching,
    refetch: refetchHealth,
  } = useHealth();

  if (isSessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-mono">Authenticating session...</p>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <LoginForm />;
  }

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20">
      {/* Top Header */}
      <header className="border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-40">
        <div className="container max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold leading-none tracking-tight">Paylink Entitlements</h1>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 font-mono">
                  v1.0
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cloudflare Workers &bull; D1 &bull; Queues &bull; Google Drive
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex text-xs py-1 px-2.5 gap-1.5">
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span>&lt;10ms CPU Free Tier</span>
            </Badge>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/40 text-xs text-muted-foreground">
              <User className="w-3.5 h-3.5 text-foreground" />
              <span className="font-medium text-foreground">{session.username || 'admin'}</span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 container max-w-7xl mx-auto p-4 sm:p-8 space-y-6">
        {/* KPI Overview Telemetry */}
        <section>
          <DashboardMetrics />
        </section>

        {/* Navigation Tabs */}
        <section className="space-y-6">
          <div className="flex items-center gap-1 border-b border-border/60 overflow-x-auto pb-px">
            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                activeTab === 'products'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              Products &amp; Payment Links
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                activeTab === 'payments'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              Transactions &amp; Resolution
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('grants')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                activeTab === 'grants'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Drive Access Grants
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('webhooks')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                activeTab === 'webhooks'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Radio className="w-4 h-4" />
              Webhook Telemetry
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 -mb-px whitespace-nowrap cursor-pointer ${
                activeTab === 'system'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Server className="w-4 h-4" />
              System Status
            </button>
          </div>

          {/* Active Tab Panel */}
          <div>
            {activeTab === 'products' && <ProductsView />}
            {activeTab === 'payments' && <PaymentsView />}
            {activeTab === 'grants' && <GrantsView />}
            {activeTab === 'webhooks' && <WebhookEventsView />}
            {activeTab === 'system' && (
              <div className="space-y-6">
                <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div>
                      <CardTitle className="text-base font-semibold">Edge Infrastructure Status</CardTitle>
                      <CardDescription className="text-xs text-muted-foreground">
                        Real-time probe to Cloudflare Workers runtime endpoint (/api/health).
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      {health && (
                        <Badge variant="success" className="gap-1.5 py-1 px-3">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>OPERATIONAL</span>
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void refetchHealth()}
                        disabled={isHealthFetching}
                        className="gap-2"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isHealthFetching ? 'animate-spin' : ''}`} />
                        Probe
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {isHealthLoading && (
                      <div className="p-8 text-center space-y-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto" />
                        <p className="text-xs text-muted-foreground">Pinging edge worker...</p>
                      </div>
                    )}

                    {isHealthError && (
                      <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-xs space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          <AlertCircle className="w-4 h-4" />
                          Health check unreachable
                        </div>
                        <p>{healthError instanceof Error ? healthError.message : 'Unknown network failure'}</p>
                      </div>
                    )}

                    {health && (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="p-4 rounded-lg bg-background/50 border border-border/50">
                          <div className="text-xs text-muted-foreground uppercase font-medium">Service</div>
                          <div className="text-lg font-bold font-mono text-foreground mt-1">{health.service}</div>
                        </div>

                        <div className="p-4 rounded-lg bg-background/50 border border-border/50">
                          <div className="text-xs text-muted-foreground uppercase font-medium">Status</div>
                          <div className="text-lg font-bold font-mono text-emerald-400 mt-1 uppercase">{health.status}</div>
                        </div>

                        <div className="p-4 rounded-lg bg-background/50 border border-border/50">
                          <div className="text-xs text-muted-foreground uppercase font-medium">Timestamp</div>
                          <div className="text-sm font-semibold font-mono text-foreground mt-1">
                            {new Date(health.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Architecture Pipelines summary */}
                <div className="grid gap-4 md:grid-cols-3">
                  <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 text-primary">
                        <CreditCard className="h-4 w-4" />
                        <CardTitle className="text-sm font-semibold">1. Webhook Ingestion</CardTitle>
                      </div>
                      <CardDescription className="text-xs">
                        Web Crypto HMAC-SHA256 signature verification in &lt;1ms CPU.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Guards payload size (&lt;100KB), validates secrets, ensures atomic idempotency.
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 text-primary">
                        <HardDrive className="h-4 w-4" />
                        <CardTitle className="text-sm font-semibold">2. Durable Outbox (D1)</CardTitle>
                      </div>
                      <CardDescription className="text-xs">
                        Atomic SQLite transactions before Queue dispatch.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Guarantees zero dropped fulfillment jobs even if downstream networks fluctuate.
                    </CardContent>
                  </Card>

                  <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2 text-primary">
                        <Layers className="h-4 w-4" />
                        <CardTitle className="text-sm font-semibold">3. Queue Consumer</CardTitle>
                      </div>
                      <CardDescription className="text-xs">
                        Asynchronous Google Drive permissions granting.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">
                      Handles token caching, rate limits, exponential backoff, and dead-letter queues.
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 bg-card/30 text-xs text-muted-foreground text-center">
        Paylink Entitlements &bull; Single-Deployment Cloudflare Architecture &bull; Tailwind CSS &amp; shadcn/ui
      </footer>
    </div>
  );
};
