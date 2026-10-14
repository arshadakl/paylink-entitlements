import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { usePaymentsList } from '@/hooks/usePayments';
import { ResolveEmailModal } from './ResolveEmailModal';
import { formatPaiseToINR } from '@/lib/utils';
import type { AccessStatus } from '@/types/api';
import {
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  UserCheck,
} from 'lucide-react';

export const PaymentsView: React.FC = () => {
  const [page, setPage] = useState(1);
  const [selectedStatus, setSelectedStatus] = useState<AccessStatus | ''>('');
  const [searchEmail, setSearchEmail] = useState('');
  const [resolvingPaymentId, setResolvingPaymentId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = usePaymentsList({
    page,
    limit: 15,
    access_status: selectedStatus || undefined,
    normalized_email: searchEmail.trim() ? searchEmail.trim().toLowerCase() : undefined,
  });

  const getStatusBadge = (status: AccessStatus) => {
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
          <Badge variant="warning" className="gap-1 font-mono text-[11px] animate-pulse">
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
      case 'queued':
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
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1 flex flex-col sm:flex-row items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by buyer email..."
                value={searchEmail}
                onChange={(e) => {
                  setSearchEmail(e.target.value);
                  setPage(1);
                }}
                className="pl-9 bg-background/50"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value as AccessStatus | '');
                  setPage(1);
                }}
                className="h-9 rounded-md border border-input bg-background/50 px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring w-full sm:w-44"
              >
                <option value="">All Access Statuses</option>
                <option value="granted">Granted</option>
                <option value="manual_review">Manual Review</option>
                <option value="pending">Pending</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="gap-2 shrink-0 self-end sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Main Table Card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Transactions &amp; Entitlements</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Audit trail of Razorpay webhook payments and Google Drive access status.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-8 text-center space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto" />
              <p className="text-xs text-muted-foreground">Loading transactions from Cloudflare D1...</p>
            </div>
          )}

          {isError && (
            <div className="p-8 text-center space-y-3">
              <XCircle className="w-6 h-6 text-destructive mx-auto" />
              <p className="text-sm font-medium text-destructive">Failed to load transactions</p>
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
              <p className="text-sm font-semibold">No transactions found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                No webhook transactions match your current search query or filter.
              </p>
            </div>
          )}

          {!isLoading && !isError && data && data.data.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment / Link ID</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Buyer Email</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((payment) => (
                    <TableRow key={payment.razorpay_payment_id}>
                      <TableCell className="font-mono text-xs">
                        <div className="font-semibold text-foreground">{payment.razorpay_payment_id}</div>
                        <div className="text-[11px] text-muted-foreground">{payment.razorpay_link_id}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-medium text-foreground">
                          {payment.product_name || 'Unmapped Product'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {payment.buyer_email ? (
                          <span className="font-mono">{payment.buyer_email}</span>
                        ) : (
                          <span className="text-amber-400 italic font-mono text-[11px]">
                            &lt;missing buyer email&gt;
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {formatPaiseToINR(payment.amount_paise)}
                      </TableCell>
                      <TableCell>{getStatusBadge(payment.access_status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {new Date(payment.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {payment.access_status === 'manual_review' || !payment.buyer_email ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10 gap-1"
                            onClick={() => setResolvingPaymentId(payment.razorpay_payment_id)}
                          >
                            <UserCheck className="w-3 h-3" />
                            Resolve
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination Bar */}
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

      {/* Resolve Email Modal */}
      <ResolveEmailModal
        paymentId={resolvingPaymentId}
        onClose={() => setResolvingPaymentId(null)}
      />
    </div>
  );
};
