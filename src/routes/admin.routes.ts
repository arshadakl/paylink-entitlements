import { Hono } from 'hono';
import { z } from 'zod';
import type { WorkerEnv } from '@/config/env';
import type { AccessStatus, OutboxJob, AccessGrant } from '@/types';
import { adminAuthMiddleware } from '@/middleware/admin-auth';
import { productsRepository } from '@/repositories/products.repository';
import { paymentsRepository } from '@/repositories/payments.repository';
import { grantsRepository } from '@/repositories/grants.repository';
import { jobsRepository } from '@/repositories/jobs.repository';
import { webhooksRepository } from '@/repositories/webhooks.repository';
import { googleDriveService, GoogleDriveError } from '@/services/google-drive-service';
import { normalizeEmail, isValidEmail } from '@/services/payment-service';

export const adminRouter = new Hono<{
  Bindings: WorkerEnv;
  Variables: { adminUser: string };
}>();

// Enforce admin authentication across all /api/admin/* routes
adminRouter.use('*', adminAuthMiddleware);

// ============================================================================
// 1. DASHBOARD OVERVIEW METRICS
// ============================================================================
adminRouter.get('/dashboard/summary', async (c) => {
  const metrics = await paymentsRepository.getDashboardMetrics(c.env.DB);
  return c.json({
    success: true,
    data: metrics,
  });
});

// ============================================================================
// 2. PRODUCT CATALOG & PAYMENT LINK MAPPINGS
// ============================================================================

const validateFolderSchema = z.object({
  folderInput: z.string().min(1),
});

adminRouter.post('/products/validate-folder', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = validateFolderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_FAILED', message: 'folderInput is required' } },
      400
    );
  }

  try {
    const metadata = await googleDriveService.validateFolder(c.env, parsed.data.folderInput);
    return c.json({
      success: true,
      data: metadata,
    });
  } catch (err: unknown) {
    if (err instanceof GoogleDriveError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.statusCode || 400
      );
    }
    return c.json(
      { error: { code: 'FOLDER_VALIDATION_FAILED', message: 'Unable to validate Google Drive folder' } },
      400
    );
  }
});

adminRouter.get('/products', async (c) => {
  const products = await productsRepository.listAll(c.env.DB);
  
  // Attach mapped links to each product
  const productsWithLinks = await Promise.all(
    products.map(async (p) => {
      const links = await productsRepository.listMappingsByProduct(c.env.DB, p.id);
      return {
        ...p,
        links,
      };
    })
  );

  return c.json({
    success: true,
    data: productsWithLinks,
  });
});

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  drive_folder_id: z.string().min(1),
  expected_amount_paise: z.number().int().positive(),
  currency: z.string().default('INR'),
});

adminRouter.post('/products', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message || 'Invalid product data' } },
      400
    );
  }

  const { name, description, drive_folder_id, expected_amount_paise, currency } = parsed.data;

  // Validate Google Drive folder access
  let validatedFolderId: string;
  try {
    const folderMeta = await googleDriveService.validateFolder(c.env, drive_folder_id);
    validatedFolderId = folderMeta.id;
  } catch (err: unknown) {
    if (err instanceof GoogleDriveError) {
      return c.json({ error: { code: err.code, message: err.message } }, 400);
    }
    return c.json({ error: { code: 'INVALID_FOLDER', message: 'Folder validation failed' } }, 400);
  }

  const now = new Date().toISOString();
  const productId = `prod_${crypto.randomUUID().slice(0, 12)}`;

  const newProduct = {
    id: productId,
    name,
    description: description ?? null,
    drive_folder_id: validatedFolderId,
    expected_amount_paise,
    currency,
    active: 1,
    created_at: now,
    updated_at: now,
  };

  await productsRepository.create(c.env.DB, newProduct);

  // Log admin action
  const adminUser = c.get('adminUser') || 'admin';
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      adminUser,
      'CREATE_PRODUCT',
      'product',
      productId,
      JSON.stringify(newProduct),
      now
    )
    .run();

  return c.json({
    success: true,
    data: newProduct,
  });
});

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  drive_folder_id: z.string().min(1).optional(),
  expected_amount_paise: z.number().int().positive().optional(),
  active: z.number().int().min(0).max(1).optional(),
});

adminRouter.patch('/products/:id', async (c) => {
  const id = c.req.param('id');
  const product = await productsRepository.findById(c.env.DB, id);
  if (!product) {
    return c.json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid update payload' } }, 400);
  }

  const updates = parsed.data;
  if (updates.drive_folder_id) {
    const meta = await googleDriveService.validateFolder(c.env, updates.drive_folder_id);
    updates.drive_folder_id = meta.id;
  }

  await productsRepository.update(c.env.DB, id, updates);

  const adminUser = c.get('adminUser') || 'admin';
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), adminUser, 'UPDATE_PRODUCT', 'product', id, JSON.stringify(updates), now)
    .run();

  const updatedProduct = await productsRepository.findById(c.env.DB, id);
  return c.json({ success: true, data: updatedProduct });
});

const linkMappingSchema = z.object({
  razorpay_link_id: z.string().min(1),
});

adminRouter.post('/products/:id/payment-links', async (c) => {
  const productId = c.req.param('id');
  const product = await productsRepository.findById(c.env.DB, productId);
  if (!product) {
    return c.json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = linkMappingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'razorpay_link_id is required' } }, 400);
  }

  const { razorpay_link_id } = parsed.data;

  // Check if link ID is already mapped to any product
  const existingMapping = await productsRepository.findByPaymentLinkId(c.env.DB, razorpay_link_id);
  if (existingMapping) {
    return c.json(
      {
        error: {
          code: 'LINK_ALREADY_MAPPED',
          message: `Payment Link ${razorpay_link_id} is already mapped to product ${existingMapping.product.name} (${existingMapping.product.id})`,
        },
      },
      409
    );
  }

  const now = new Date().toISOString();
  await productsRepository.addLinkMapping(c.env.DB, {
    razorpay_link_id,
    product_id: productId,
    active: 1,
    created_at: now,
  });

  const adminUser = c.get('adminUser') || 'admin';
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      adminUser,
      'MAP_PAYMENT_LINK',
      'payment_link_mapping',
      razorpay_link_id,
      JSON.stringify({ productId }),
      now
    )
    .run();

  return c.json({
    success: true,
    data: { razorpay_link_id, product_id: productId, active: 1 },
  });
});

adminRouter.delete('/payment-links/:linkId', async (c) => {
  const linkId = c.req.param('linkId');
  await productsRepository.disableLinkMapping(c.env.DB, linkId);

  const adminUser = c.get('adminUser') || 'admin';
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(crypto.randomUUID(), adminUser, 'DISABLE_PAYMENT_LINK', 'payment_link_mapping', linkId, null, now)
    .run();

  return c.json({ success: true, message: `Payment link ${linkId} mapping disabled` });
});

// ============================================================================
// 3. TRANSACTIONS & MANUAL EMAIL RESOLUTION
// ============================================================================

adminRouter.get('/payments', async (c) => {
  const page = Number(c.req.query('page') || '1');
  const limit = Number(c.req.query('limit') || '25');
  const access_status = c.req.query('access_status') as AccessStatus | undefined;
  const product_id = c.req.query('product_id') || undefined;
  const normalized_email = c.req.query('normalized_email') || undefined;
  const razorpay_link_id = c.req.query('razorpay_link_id') || undefined;

  const result = await paymentsRepository.listPaginated(c.env.DB, {
    page,
    limit,
    access_status,
    product_id,
    normalized_email,
    razorpay_link_id,
  });

  return c.json({
    success: true,
    ...result,
  });
});

adminRouter.get('/payments/:id', async (c) => {
  const id = c.req.param('id');
  const payment = await paymentsRepository.findById(c.env.DB, id);
  if (!payment) {
    return c.json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment record not found' } }, 404);
  }

  let product = null;
  if (payment.product_id) {
    product = await productsRepository.findById(c.env.DB, payment.product_id);
  }

  return c.json({
    success: true,
    data: {
      ...payment,
      product,
    },
  });
});

const resolveEmailSchema = z.object({
  buyer_email: z.string().email(),
});

adminRouter.post('/payments/:id/resolve-email', async (c) => {
  const paymentId = c.req.param('id');
  const payment = await paymentsRepository.findById(c.env.DB, paymentId);
  if (!payment) {
    return c.json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment record not found' } }, 404);
  }

  if (!payment.product_id) {
    return c.json(
      {
        error: {
          code: 'UNMAPPED_PAYMENT',
          message: 'Cannot resolve email for payment without a mapped product.',
        },
      },
      400
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = resolveEmailSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'INVALID_EMAIL', message: 'A valid email address is required' } }, 400);
  }

  const rawEmail = parsed.data.buyer_email;
  const normalized = normalizeEmail(rawEmail);
  const now = new Date().toISOString();

  const product = await productsRepository.findById(c.env.DB, payment.product_id);
  if (!product) {
    return c.json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product record missing' } }, 404);
  }

  // Check if grant already exists for this folder & normalized email
  const existingGrant = await grantsRepository.findByFolderAndEmail(
    c.env.DB,
    product.drive_folder_id,
    normalized
  );

  let grantId: string;
  let outboxJobId: string | undefined;

  if (existingGrant && existingGrant.status === 'granted') {
    // Re-use existing granted state
    grantId = existingGrant.id;
    await paymentsRepository.resolveBuyerEmail(c.env.DB, paymentId, rawEmail, normalized, 'granted');
  } else {
    grantId = existingGrant ? existingGrant.id : crypto.randomUUID();
    outboxJobId = crypto.randomUUID();
    const dedupeKey = `${grantId}:grant_access`;

    if (!existingGrant) {
      const grantRecord: AccessGrant = {
        id: grantId,
        product_id: product.id,
        drive_folder_id: product.drive_folder_id,
        buyer_email: rawEmail,
        normalized_email: normalized,
        status: 'pending',
        permission_id: null,
        attempt_count: 0,
        next_attempt_at: now,
        lease_until: null,
        last_error_code: null,
        last_attempt_at: null,
        granted_at: null,
        created_at: now,
        updated_at: now,
      };
      await grantsRepository.create(c.env.DB, grantRecord);
    }

    const outboxJob: OutboxJob = {
      id: outboxJobId,
      job_type: 'grant_access',
      grant_id: grantId,
      dedupe_key: dedupeKey,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: now,
      last_attempt_at: null,
      dispatched_at: null,
      lease_until: null,
      last_error_code: null,
      created_at: now,
      updated_at: now,
    };
    await jobsRepository.create(c.env.DB, outboxJob);

    // Update payment record to pending
    await paymentsRepository.resolveBuyerEmail(c.env.DB, paymentId, rawEmail, normalized, 'pending');

    // Enqueue job to Cloudflare Queue
    try {
      await c.env.GRANT_QUEUE.send({
        grantId,
        outboxJobId,
      });
      await jobsRepository.markQueued(c.env.DB, outboxJobId);
      await paymentsRepository.updateAccessStatus(c.env.DB, paymentId, 'queued');
    } catch (enqueueErr) {
      console.error('[AdminRoutes] Failed to enqueue resolved grant job:', enqueueErr);
      // Job remains pending for recovery cron
    }
  }

  // Record admin audit log
  const adminUser = c.get('adminUser') || 'admin';
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      adminUser,
      'RESOLVE_BUYER_EMAIL',
      'payment',
      paymentId,
      JSON.stringify({ buyerEmail: rawEmail, normalizedEmail: normalized, grantId }),
      now
    )
    .run();

  const updatedPayment = await paymentsRepository.findById(c.env.DB, paymentId);
  return c.json({
    success: true,
    data: updatedPayment,
  });
});

// ============================================================================
// 4. GRANTS MANAGEMENT & MANUAL RETRY
// ============================================================================

adminRouter.get('/grants', async (c) => {
  const page = Number(c.req.query('page') || '1');
  const limit = Number(c.req.query('limit') || '25');

  const result = await grantsRepository.listPaginated(c.env.DB, page, limit);
  return c.json({
    success: true,
    ...result,
  });
});

adminRouter.post('/grants/:id/retry', async (c) => {
  const grantId = c.req.param('id');
  const grant = await grantsRepository.findById(c.env.DB, grantId);
  if (!grant) {
    return c.json({ error: { code: 'GRANT_NOT_FOUND', message: 'Access grant not found' } }, 404);
  }

  if (grant.status === 'granted') {
    return c.json(
      { error: { code: 'ALREADY_GRANTED', message: 'Grant has already been fulfilled' } },
      400
    );
  }

  const now = new Date().toISOString();

  // Reset grant in D1
  await c.env.DB.prepare(
    'UPDATE access_grants SET status = ?, attempt_count = 0, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ?'
  )
    .bind('pending', now, now, grantId)
    .run();

  // Find or create outbox job
  let outboxJob = await jobsRepository.findByGrantId(c.env.DB, grantId);
  const outboxJobId = outboxJob ? outboxJob.id : crypto.randomUUID();

  if (outboxJob) {
    await c.env.DB.prepare(
      'UPDATE outbox_jobs SET status = ?, attempt_count = 0, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ?'
    )
      .bind('pending', now, now, outboxJob.id)
      .run();
  } else {
    const newJob: OutboxJob = {
      id: outboxJobId,
      job_type: 'grant_access',
      grant_id: grantId,
      dedupe_key: `${grantId}:grant_access`,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: now,
      last_attempt_at: null,
      dispatched_at: null,
      lease_until: null,
      last_error_code: null,
      created_at: now,
      updated_at: now,
    };
    await jobsRepository.create(c.env.DB, newJob);
  }

  // Update associated payment to queued
  await paymentsRepository.updateAccessStatusByProductAndEmail(
    c.env.DB,
    grant.product_id,
    grant.normalized_email,
    'queued'
  );

  // Dispatch queue message
  try {
    await c.env.GRANT_QUEUE.send({
      grantId,
      outboxJobId,
    });
    await jobsRepository.markQueued(c.env.DB, outboxJobId);
  } catch (err) {
    console.error('[AdminRoutes] Error re-enqueueing grant:', err);
  }

  // Record audit log
  const adminUser = c.get('adminUser') || 'admin';
  await c.env.DB.prepare(
    'INSERT INTO admin_audit_logs (id, admin_user, action, target_entity, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      crypto.randomUUID(),
      adminUser,
      'MANUAL_RETRY_GRANT',
      'access_grant',
      grantId,
      JSON.stringify({ outboxJobId }),
      now
    )
    .run();

  return c.json({
    success: true,
    message: `Grant ${grantId} queued for retry`,
  });
});

// ============================================================================
// 5. WEBHOOK EVENTS AUDIT MONITOR
// ============================================================================

adminRouter.get('/webhook-events', async (c) => {
  const limit = Math.min(50, Number(c.req.query('limit') || '25'));
  const events = await webhooksRepository.listRecent(c.env.DB, limit);
  return c.json({
    success: true,
    data: events,
  });
});
