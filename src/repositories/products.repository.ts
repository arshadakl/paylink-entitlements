import type { Product, PaymentLinkMapping } from '@/types';

export interface ProductWithMapping extends Product {
  razorpay_link_id: string | null;
  link_active: number | null;
}

export const productsRepository = {
  async findById(db: D1Database, id: string): Promise<Product | null> {
    return db
      .prepare('SELECT * FROM products WHERE id = ?')
      .bind(id)
      .first<Product>();
  },

  async findByPaymentLinkId(
    db: D1Database,
    linkId: string
  ): Promise<{ product: Product; mapping: PaymentLinkMapping } | null> {
    const row = await db
      .prepare(
        `SELECT 
          p.id, p.name, p.description, p.drive_folder_id, p.expected_amount_paise, 
          p.currency, p.active, p.created_at, p.updated_at,
          m.razorpay_link_id, m.active AS mapping_active, m.created_at AS mapping_created_at
        FROM payment_link_mappings m
        JOIN products p ON p.id = m.product_id
        WHERE m.razorpay_link_id = ?`
      )
      .bind(linkId)
      .first<{
        id: string;
        name: string;
        description: string | null;
        drive_folder_id: string;
        expected_amount_paise: number;
        currency: string;
        active: number;
        created_at: string;
        updated_at: string;
        razorpay_link_id: string;
        mapping_active: number;
        mapping_created_at: string;
      }>();

    if (!row) {
      return null;
    }

    return {
      product: {
        id: row.id,
        name: row.name,
        description: row.description,
        drive_folder_id: row.drive_folder_id,
        expected_amount_paise: row.expected_amount_paise,
        currency: row.currency,
        active: row.active,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      mapping: {
        razorpay_link_id: row.razorpay_link_id,
        product_id: row.id,
        active: row.mapping_active,
        created_at: row.mapping_created_at,
      },
    };
  },

  async listAll(db: D1Database): Promise<Product[]> {
    const result = await db
      .prepare('SELECT * FROM products ORDER BY created_at DESC')
      .all<Product>();
    return result.results;
  },

  createStmt(db: D1Database, product: Product): D1PreparedStatement {
    return db
      .prepare(
        `INSERT INTO products (
          id, name, description, drive_folder_id, expected_amount_paise, currency, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        product.id,
        product.name,
        product.description,
        product.drive_folder_id,
        product.expected_amount_paise,
        product.currency,
        product.active,
        product.created_at,
        product.updated_at
      );
  },

  async create(db: D1Database, product: Product): Promise<void> {
    await this.createStmt(db, product).run();
  },

  async update(
    db: D1Database,
    id: string,
    updates: {
      name?: string | undefined;
      description?: string | null | undefined;
      drive_folder_id?: string | undefined;
      expected_amount_paise?: number | undefined;
      active?: number | undefined;
    }
  ): Promise<void> {
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [new Date().toISOString()];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.drive_folder_id !== undefined) {
      setClauses.push('drive_folder_id = ?');
      values.push(updates.drive_folder_id);
    }
    if (updates.expected_amount_paise !== undefined) {
      setClauses.push('expected_amount_paise = ?');
      values.push(updates.expected_amount_paise);
    }
    if (updates.active !== undefined) {
      setClauses.push('active = ?');
      values.push(updates.active);
    }

    values.push(id);

    await db
      .prepare(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  },

  createLinkMappingStmt(db: D1Database, mapping: PaymentLinkMapping): D1PreparedStatement {
    return db
      .prepare(
        'INSERT INTO payment_link_mappings (razorpay_link_id, product_id, active, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(mapping.razorpay_link_id, mapping.product_id, mapping.active, mapping.created_at);
  },

  async addLinkMapping(db: D1Database, mapping: PaymentLinkMapping): Promise<void> {
    await this.createLinkMappingStmt(db, mapping).run();
  },

  async disableLinkMapping(db: D1Database, linkId: string): Promise<void> {
    await db
      .prepare('UPDATE payment_link_mappings SET active = 0 WHERE razorpay_link_id = ?')
      .bind(linkId)
      .run();
  },

  async listMappingsByProduct(db: D1Database, productId: string): Promise<PaymentLinkMapping[]> {
    const result = await db
      .prepare('SELECT * FROM payment_link_mappings WHERE product_id = ? ORDER BY created_at DESC')
      .bind(productId)
      .all<PaymentLinkMapping>();
    return result.results;
  },
};
