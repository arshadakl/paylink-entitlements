import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useResolveEmail } from '@/hooks/usePayments';
import { Mail, AlertCircle, Loader2, X } from 'lucide-react';

interface ResolveEmailModalProps {
  paymentId: string | null;
  onClose: () => void;
}

export const ResolveEmailModal: React.FC<ResolveEmailModalProps> = ({ paymentId, onClose }) => {
  const [email, setEmail] = useState('');
  const resolveMutation = useResolveEmail();

  if (!paymentId) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !paymentId) return;

    resolveMutation.mutate(
      { paymentId, buyerEmail: email.trim() },
      {
        onSuccess: () => {
          setEmail('');
          onClose();
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <Card className="w-full max-w-md border-border/80 shadow-2xl bg-card">
        <CardHeader className="relative flex flex-col space-y-1 pb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute right-4 top-4 h-8 w-8 text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X className="w-4 h-4" />
          </Button>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Resolve Buyer Email
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Provide the buyer&apos;s Google account email to unblock Google Drive folder sharing.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="text-xs bg-muted/60 p-3 rounded-md font-mono text-muted-foreground break-all">
              Payment ID: <span className="text-foreground font-semibold">{paymentId}</span>
            </div>

            {resolveMutation.isError && (
              <div className="flex items-center gap-2 p-3 text-sm rounded-lg bg-destructive/15 text-destructive border border-destructive/20">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{resolveMutation.error?.message || 'Failed to update email and dispatch queue'}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Buyer Google Email
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="buyer@gmail.com"
                disabled={resolveMutation.isPending}
                required
                autoFocus
              />
            </div>
          </CardContent>

          <CardFooter className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={resolveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={resolveMutation.isPending || !email.trim()}
              className="gap-2"
            >
              {resolveMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Granting Access...
                </>
              ) : (
                'Resolve & Enqueue'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
