import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLoginMutation } from '@/hooks/useAuth';
import { ShieldCheck, Lock, User, AlertCircle, Loader2 } from 'lucide-react';

export const LoginForm: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const loginMutation = useLoginMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border/80 shadow-2xl bg-card/80 backdrop-blur-md">
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-2 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Admin Portal</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Sign in to manage Razorpay mappings, Drive entitlements, and recovery queues.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {loginMutation.isError && (
              <div className="flex items-center gap-2 p-3 text-sm rounded-lg bg-destructive/15 text-destructive border border-destructive/20 animate-in fade-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loginMutation.error?.message || 'Invalid username or password'}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                disabled={loginMutation.isPending}
                required
                autoComplete="username"
                className="bg-background/50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={loginMutation.isPending}
                required
                autoComplete="current-password"
                className="bg-background/50"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              type="submit"
              className="w-full gap-2 font-medium"
              disabled={loginMutation.isPending || !username.trim() || !password}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Sign In to Dashboard'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
