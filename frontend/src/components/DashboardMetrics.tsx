import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDashboardSummary } from '@/hooks/useDashboard';
import { formatPaiseToINR } from '@/lib/utils';
import {
  IndianRupee,
  ShoppingBag,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Clock,
  XCircle,
} from 'lucide-react';

export const DashboardMetrics: React.FC = () => {
  const { data: metrics, isLoading, isError, error, refetch, isFetching } = useDashboardSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-border/60 bg-card/50">
            <CardHeader className="pb-2">
              <div className="h-4 bg-muted rounded w-24 mb-2" />
              <div className="h-8 bg-muted rounded w-36" />
            </CardHeader>
            <CardContent>
              <div className="h-3 bg-muted rounded w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-destructive/30 bg-destructive/10 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-destructive">
            <XCircle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold">Failed to load real-time telemetry</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {error instanceof Error ? error.message : 'Unknown telemetry retrieval failure'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!metrics) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Gross Revenue */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm transition-all hover:border-primary/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Gross Revenue
          </CardTitle>
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <IndianRupee className="w-4 h-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tracking-tight">
            {formatPaiseToINR(metrics.grossRevenuePaise)}
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <span>Captured via Razorpay Webhooks</span>
          </p>
        </CardContent>
      </Card>

      {/* 2. Total Successful Orders */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm transition-all hover:border-primary/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Sales
          </CardTitle>
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <ShoppingBag className="w-4 h-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tracking-tight">
            {metrics.totalSuccessfulPayments.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Confirmed customer payments
          </p>
        </CardContent>
      </Card>

      {/* 3. Granted Access Entitlements */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm transition-all hover:border-primary/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Granted Access
          </CardTitle>
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tracking-tight">
            {metrics.grantedAccessCount.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-400" />
              {metrics.pendingAccessCount} pending
            </span>
            {metrics.failedAccessCount > 0 && (
              <span className="text-destructive font-medium">
                &bull; {metrics.failedAccessCount} failed
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. Manual Review Attention */}
      <Card
        className={`border-border/60 bg-card/60 backdrop-blur-sm transition-all ${
          metrics.manualReviewCount > 0
            ? 'border-amber-500/50 bg-amber-500/5 shadow-amber-500/5 shadow-lg'
            : 'hover:border-primary/40'
        }`}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Manual Review
          </CardTitle>
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              metrics.manualReviewCount > 0
                ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold tracking-tight ${
              metrics.manualReviewCount > 0 ? 'text-amber-400' : ''
            }`}
          >
            {metrics.manualReviewCount.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {metrics.manualReviewCount > 0
              ? 'Missing buyer email requires resolution'
              : 'All transactions cleanly fulfilled'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
