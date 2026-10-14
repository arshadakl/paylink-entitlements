import React from 'react';
import { useHealth } from './hooks/useHealth';

export const App: React.FC = () => {
  const { data: health, isLoading, isError, error, refetch } = useHealth();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border-color)',
          padding: '1rem 2rem',
          backgroundColor: 'var(--bg-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: health?.status === 'ok' ? 'var(--success)' : 'var(--warning)',
              boxShadow: health?.status === 'ok' ? '0 0 8px var(--success)' : 'none',
            }}
          />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Paylink Entitlements</h1>
        </div>
        <span
          style={{
            fontSize: '0.85rem',
            padding: '0.25rem 0.75rem',
            borderRadius: '9999px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
          }}
        >
          Phase 1: Single Deployment Foundation
        </span>
      </header>

      <main style={{ flex: 1, padding: '2rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <section
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '1.5rem',
            marginBottom: '2rem',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>System Status</h2>

          {isLoading && (
            <p style={{ color: 'var(--text-secondary)' }}>Checking Cloudflare Worker API connectivity...</p>
          )}

          {isError && (
            <div
              style={{
                backgroundColor: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                padding: '1rem',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
              }}
            >
              <p style={{ fontWeight: 600, color: 'var(--danger)' }}>Connection Error</p>
              <p style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>
                {error instanceof Error ? error.message : 'Unknown error occurred'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.5rem 1rem',
                  backgroundColor: 'var(--danger)',
                  color: '#fff',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              >
                Retry Probe
              </button>
            </div>
          )}

          {health && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Status</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--success)', marginTop: '0.25rem' }}>
                  {health.status.toUpperCase()}
                </div>
              </div>

              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Service</div>
                <div style={{ fontSize: '1rem', fontWeight: 500, marginTop: '0.25rem' }}>{health.service}</div>
              </div>

              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Server Timestamp</div>
                <div style={{ fontSize: '0.9rem', marginTop: '0.25rem', color: 'var(--text-secondary)' }}>
                  {new Date(health.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
