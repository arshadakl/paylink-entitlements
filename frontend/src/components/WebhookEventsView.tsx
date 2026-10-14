import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWebhookEventsList } from '@/hooks/useWebhookEvents';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Radio,
} from 'lucide-react';

export const WebhookEventsView: React.FC = () => {
  const { data, isLoading, isError, error, refetch, isFetching } = useWebhookEventsList(30);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'processed':
        return (
          <Badge variant="success" className="gap-1 font-mono text-[11px]">
            <CheckCircle2 className="w-3 h-3" />
            Processed
          </Badge>
        );
      case 'ignored':
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-[11px]">
            <Clock className="w-3 h-3" />
            Ignored
          </Badge>
        );
      case 'unmapped':
        return (
          <Badge variant="warning" className="gap-1 font-mono text-[11px]">
            <AlertTriangle className="w-3 h-3" />
            Unmapped
          </Badge>
        );
      case 'manual_review':
        return (
          <Badge variant="warning" className="gap-1 font-mono text-[11px]">
            <AlertTriangle className="w-3 h-3" />
            Manual Review
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1 font-mono text-[11px]">
            <XCircle className="w-3 h-3" />
            Failed
          </Badge>
        );
      case 'received':
      default:
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-[11px]">
            {status}
          </Badge>
        );
    }
  };

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 gap-2">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary animate-pulse" />
            Webhook Ingestion Telemetry
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Idempotent event log of inbound Razorpay webhook deliveries.
          </CardDescription>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && (
          <div className="p-8 text-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto" />
            <p className="text-xs text-muted-foreground">Loading recent webhook receipts...</p>
          </div>
        )}

        {isError && (
          <div className="p-8 text-center space-y-3">
            <XCircle className="w-6 h-6 text-destructive mx-auto" />
            <p className="text-sm font-medium text-destructive">Failed to load webhook events</p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : 'Database error'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && data && data.data.length === 0 && (
          <div className="p-12 text-center space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground/60 mx-auto" />
            <p className="text-sm font-semibold">No webhooks received yet</p>
            <p className="text-xs text-muted-foreground">
              Inbound Razorpay webhook notifications will appear here with payload signatures and status.
            </p>
          </div>
        )}

        {!isLoading && !isError && data && data.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event ID</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Payment / Link ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason Code</TableHead>
                <TableHead className="text-right">Received At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((event) => (
                <TableRow key={event.event_id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {event.event_id}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    <Badge variant="outline" className="text-[11px] font-mono">
                      {event.event_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {event.razorpay_payment_id || event.razorpay_link_id || '—'}
                  </TableCell>
                  <TableCell>{getStatusBadge(event.processing_status)}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {event.reason_code || '—'}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground font-mono">
                    {new Date(event.received_at).toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
