import React from 'react';
import { useHealth } from './hooks/useHealth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Server, 
  Clock, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  CreditCard, 
  HardDrive 
} from 'lucide-react';

export const App: React.FC = () => {
  const { data: health, isLoading, isError, error, isFetching, refetch } = useHealth();

  const handleRefresh = () => {
    void refetch();
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none tracking-tight">Paylink Entitlements</h1>
              <p className="text-xs text-muted-foreground mt-1">Razorpay &bull; Cloudflare D1/Queues &bull; Google Drive</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-xs py-1 px-2.5">
              Workers Free Tier (&lt;10ms CPU)
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span>{isFetching ? 'Probing...' : 'Refresh'}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container max-w-7xl mx-auto p-4 sm:p-8 space-y-8">
        {/* System Status Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Edge Infrastructure Status</h2>
              <p className="text-sm text-muted-foreground">
                Live health telemetry from the Cloudflare Worker runtime
              </p>
            </div>

            {health && (
              <Badge variant="success" className="gap-1.5 py-1 px-3">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>ONLINE</span>
              </Badge>
            )}
          </div>

          {/* 1. Loading State */}
          {isLoading && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-10 space-y-3">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Connecting to Cloudflare edge runtime...</p>
              </CardContent>
            </Card>
          )}

          {/* 2. Error State */}
          {isError && (
            <Card className="border-destructive/50 bg-destructive/10">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <CardTitle className="text-base">Health Probe Connection Failed</CardTitle>
                </div>
                <CardDescription className="text-destructive/80">
                  {error instanceof Error ? error.message : 'Unable to connect to edge worker API'}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                <Button variant="destructive" size="sm" onClick={handleRefresh}>
                  Retry Connection
                </Button>
              </CardContent>
            </Card>
          )}

          {/* 3. Success State with Telemetry Cards */}
          {health && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Runtime Status
                  </CardTitle>
                  <Server className="h-4 w-4 text-emerald-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-400 uppercase">
                    {health.status}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Edge router operational
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Service Name
                  </CardTitle>
                  <Layers className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    {health.service}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Single deployment bundle
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Edge Timestamp
                  </CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold font-mono text-foreground">
                    {new Date(health.timestamp).toLocaleTimeString()}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(health.timestamp).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        {/* Feature Pipelines Blueprint */}
        <section className="space-y-4 pt-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Active Automation Pipelines</h2>
            <p className="text-sm text-muted-foreground">
              Event-driven architecture components configured for digital fulfillment
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">1. Webhook Ingestion</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Native Web Crypto HMAC-SHA256 signature verification in &lt;1ms CPU.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Resolves exact Payment Link IDs to configured products and validates full capture.
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">2. Durable Outbox (D1)</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Atomic batch transactions in D1 prior to Queue publication.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Persists event, payment, access grant, and outbox job with 1-minute cron recovery.
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-semibold">3. Queue Consumer</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Asynchronous Google Drive Viewer (reader) role provisioning.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Idempotent permission checks with database leasing and dead-letter queue recovery.
              </CardContent>
            </Card>
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
