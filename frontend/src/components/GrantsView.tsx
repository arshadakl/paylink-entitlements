import React, { useState } from 'react';
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
import { useGrantsList, useRetryGrant } from '@/hooks/useGrants';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  RefreshCw,
  RotateCcw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

export const GrantsView: React.FC = () => {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch, isFetching } = useGrantsList({ page, limit: 15 });
  const retryMutation = useRetryGrant();

  const handleRetry = (grantId: string) => {
    retryMutation.mutate(grantId);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'granted':
        return (
          <Badge variant="success" className="gap-1 font-mono text-[11px]">
            <CheckCircle2 className="w-3 h-3" />
            Granted
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
      case 'processing':
      case 'pending':
      default:
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-[11px]">
            <Clock className="w-3 h-3" />
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
            <ShieldCheck className="w-4 h-4 text-primary" />
            Google Drive Access Grants
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Entitlement state, asynchronous queue leases, and permissions granted to buyers.
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
            <p className="text-xs text-muted-foreground">Loading access grants from Cloudflare D1...</p>
          </div>
        )}

        {isError && (
          <div className="p-8 text-center space-y-3">
            <XCircle className="w-6 h-6 text-destructive mx-auto" />
            <p className="text-sm font-medium text-destructive">Failed to load grants</p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : 'D1 Query Failure'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && data && data.data.length === 0 && (
          <div className="p-12 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground/60 mx-auto" />
            <p className="text-sm font-semibold">No access grants recorded</p>
            <p className="text-xs text-muted-foreground">
              Grants will appear here once incoming webhooks are processed.
            </p>
          </div>
        )}

        {!isLoading && !isError && data && data.data.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grant ID</TableHead>
                  <TableHead>Buyer Email</TableHead>
                  <TableHead>Drive Folder</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Granted / Next Attempt</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((grant) => (
                  <TableRow key={grant.id}>
                    <TableCell className="font-mono text-xs font-semibold">
                      {grant.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {grant.buyer_email}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {grant.drive_folder_id.slice(0, 12)}...
                    </TableCell>
                    <TableCell>{getStatusBadge(grant.status)}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {grant.attempt_count}
                      {grant.last_error_code && (
                        <div className="text-[10px] text-destructive truncate max-w-[120px]">
                          {grant.last_error_code}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {grant.granted_at
                        ? new Date(grant.granted_at).toLocaleString()
                        : grant.next_attempt_at
                        ? `Retry: ${new Date(grant.next_attempt_at).toLocaleTimeString()}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {grant.status !== 'granted' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => handleRetry(grant.id)}
                          disabled={retryMutation.isPending}
                        >
                          {retryMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40 text-xs text-muted-foreground">
              <div>
                Page <span className="font-medium text-foreground">{data.page}</span> of{' '}
                <span className="font-medium text-foreground">{data.totalPages}</span> ({data.total} total)
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
