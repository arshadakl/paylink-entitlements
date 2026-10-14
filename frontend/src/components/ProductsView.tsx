import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useProductsList,
  useCreateProduct,
  useValidateFolder,
  useAddPaymentLink,
  useDisablePaymentLink,
} from '@/hooks/useProducts';
import { formatPaiseToINR } from '@/lib/utils';
import type { FolderValidationResult } from '@/types/api';
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Link as LinkIcon,
  X,
  Loader2,
  FolderCheck,
  RefreshCw,
  XCircle,
  Layers,
} from 'lucide-react';

export const ProductsView: React.FC = () => {
  const { data: products, isLoading, isError, error, refetch, isFetching } = useProductsList();

  // Create Product form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [validatedFolder, setValidatedFolder] = useState<FolderValidationResult | null>(null);

  // Link mapping state
  const [newLinkIdByProduct, setNewLinkIdByProduct] = useState<Record<string, string>>({});

  const validateFolderMutation = useValidateFolder();
  const createProductMutation = useCreateProduct();
  const addPaymentLinkMutation = useAddPaymentLink();
  const disablePaymentLinkMutation = useDisablePaymentLink();

  const handleValidateFolder = () => {
    if (!folderInput.trim()) return;
    validateFolderMutation.mutate(folderInput.trim(), {
      onSuccess: (data) => {
        setValidatedFolder(data);
      },
    });
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const rupees = parseFloat(amountRupees);
    if (!name.trim() || isNaN(rupees) || rupees <= 0 || !folderInput.trim()) return;

    const folderId = validatedFolder ? validatedFolder.id : folderInput.trim();
    const expectedAmountPaise = Math.round(rupees * 100);

    createProductMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        drive_folder_id: folderId,
        expected_amount_paise: expectedAmountPaise,
        currency: 'INR',
      },
      {
        onSuccess: () => {
          setShowCreateForm(false);
          setName('');
          setDescription('');
          setAmountRupees('');
          setFolderInput('');
          setValidatedFolder(null);
        },
      }
    );
  };

  const handleAddLink = (productId: string) => {
    const linkId = newLinkIdByProduct[productId]?.trim();
    if (!linkId) return;

    addPaymentLinkMutation.mutate(
      { productId, linkId },
      {
        onSuccess: () => {
          setNewLinkIdByProduct((prev) => ({ ...prev, [productId]: '' }));
        },
      }
    );
  };

  const handleDisableLink = (linkId: string) => {
    disablePaymentLinkMutation.mutate(linkId);
  };

  return (
    <div className="space-y-6">
      {/* Top Header / Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Product Catalog &amp; Payment Links</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure Google Drive folder entitlements and map Razorpay payment links.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <Button
            size="sm"
            onClick={() => setShowCreateForm(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Create Product Modal / Form */}
      {showCreateForm && (
        <Card className="border-primary/40 bg-card/90 shadow-xl backdrop-blur-md animate-in fade-in">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">New Digital Product</CardTitle>
              <CardDescription className="text-xs">
                Associate a Google Drive folder with an expected payment amount and payment link.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowCreateForm(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </CardHeader>

          <form onSubmit={handleCreateProduct}>
            <CardContent className="space-y-4">
              {createProductMutation.isError && (
                <div className="flex items-center gap-2 p-3 text-xs rounded-lg bg-destructive/15 text-destructive border border-destructive/20">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{createProductMutation.error?.message || 'Failed to create product'}</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Product Title
                  </label>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Masterclass Course Access"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Expected Price (INR ₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                    placeholder="999.00"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Description (Optional)
                </label>
                <Input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Automated reader access granted on purchase"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Google Drive Folder URL or ID
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={folderInput}
                    onChange={(e) => {
                      setFolderInput(e.target.value);
                      setValidatedFolder(null);
                    }}
                    placeholder="https://drive.google.com/drive/folders/1abc... or 1abc..."
                    required
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleValidateFolder}
                    disabled={validateFolderMutation.isPending || !folderInput.trim()}
                    className="gap-2 shrink-0"
                  >
                    {validateFolderMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderCheck className="w-3.5 h-3.5" />
                    )}
                    Verify Folder
                  </Button>
                </div>

                {validateFolderMutation.isError && (
                  <p className="text-xs text-destructive flex items-center gap-1.5 pt-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {validateFolderMutation.error?.message || 'Folder verification failed'}
                  </p>
                )}

                {validatedFolder && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-xs text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <div>
                      <span className="font-semibold">{validatedFolder.name}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-[11px]">
                        (ID: {validatedFolder.id} &bull; Permissions: Verified)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCreateForm(false)}
                disabled={createProductMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createProductMutation.isPending || !name.trim() || !amountRupees || !folderInput.trim()}
                className="gap-2"
              >
                {createProductMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Create Product'
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* 4-State Views for Product List */}
      {isLoading && (
        <div className="p-12 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto" />
          <p className="text-xs text-muted-foreground">Loading products and link mappings from D1...</p>
        </div>
      )}

      {isError && (
        <Card className="border-destructive/30 bg-destructive/10 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-destructive">
              <XCircle className="w-5 h-5 shrink-0" />
              <div>
                <p className="font-semibold text-sm">Failed to retrieve product catalog</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {error instanceof Error ? error.message : 'D1 Query Failure'}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {!isLoading && !isError && products && products.length === 0 && (
        <Card className="border-dashed border-2 border-border/80 bg-card/40 p-12 text-center">
          <Layers className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-semibold">No digital products configured</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1 mb-4">
            Create your first product to link Razorpay payment links to Google Drive folders.
          </p>
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Add First Product
          </Button>
        </Card>
      )}

      {!isLoading && !isError && products && products.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {products.map((product) => (
            <Card key={product.id} className="border-border/60 bg-card/60 backdrop-blur-sm">
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">{product.name}</CardTitle>
                    <Badge variant={product.active ? 'success' : 'secondary'} className="text-[10px]">
                      {product.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  {product.description && (
                    <CardDescription className="text-xs">{product.description}</CardDescription>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold text-foreground">
                    {formatPaiseToINR(product.expected_amount_paise)}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    ID: {product.id.slice(0, 8)}...
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                {/* Drive Folder ID info */}
                <div className="flex items-center gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/40 font-mono">
                  <HardDrive className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-muted-foreground">Drive Folder ID:</span>
                  <span className="text-foreground font-medium select-all">{product.drive_folder_id}</span>
                </div>

                {/* Mapped Razorpay Links Section */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5" />
                    Mapped Razorpay Links
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    {product.links.filter((l) => l.active === 1).length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">
                        No active payment links mapped. Webhooks for unmapped links will be recorded as unmapped.
                      </span>
                    ) : (
                      product.links
                        .filter((l) => l.active === 1)
                        .map((link) => (
                          <Badge
                            key={link.razorpay_link_id}
                            variant="outline"
                            className="font-mono text-xs py-1 px-2.5 bg-background/50 border-border/80 flex items-center gap-1.5"
                          >
                            <span>{link.razorpay_link_id}</span>
                            <button
                              type="button"
                              onClick={() => handleDisableLink(link.razorpay_link_id)}
                              disabled={disablePaymentLinkMutation.isPending}
                              className="text-muted-foreground hover:text-destructive transition-colors ml-1 cursor-pointer"
                              title="Unlink"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))
                    )}
                  </div>

                  {/* Add New Link ID Input */}
                  <div className="flex gap-2 max-w-sm pt-1">
                    <Input
                      type="text"
                      placeholder="plink_xxxxxxxxx"
                      value={newLinkIdByProduct[product.id] || ''}
                      onChange={(e) =>
                        setNewLinkIdByProduct((prev) => ({
                          ...prev,
                          [product.id]: e.target.value,
                        }))
                      }
                      className="h-8 text-xs font-mono bg-background/50"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 text-xs shrink-0"
                      onClick={() => handleAddLink(product.id)}
                      disabled={
                        addPaymentLinkMutation.isPending || !newLinkIdByProduct[product.id]?.trim()
                      }
                    >
                      {addPaymentLinkMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Map Link'
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
