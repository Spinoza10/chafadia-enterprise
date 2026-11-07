-- Permissions, role defaults, settings and delivery zones.
-- super_admin implicitly holds every permission (enforced in code), so it has no rows here.

INSERT INTO permissions (code, description, category, grantable) VALUES
  ('users.manage',            'Create, edit, suspend and delete staff; change permissions', 'Administration', false),
  ('settings.manage',         'Change shop settings, taxes and thresholds',                 'Administration', false),
  ('audit.view',              'View the audit log',                                         'Administration', false),
  ('refunds.manage',          'Issue partial or full refunds',                              'Finance',        false),
  ('reports.full',            'Full reports: profit, revenue by method/cashier/category',   'Finance',        true),
  ('reports.sales_total',     'View total amount sold, order and delivery queues',          'Reports',        true),
  ('reports.slow_products',   'View slow-moving products and stuck orders',                 'Reports',        true),
  ('payments.view',           'View all payment transactions',                              'Finance',        true),
  ('payments.record_cash',    'Record cash payments on pending orders',                     'Finance',        true),
  ('coupons.manage',          'Manage coupons, promotions and discounts',                   'Sales',          true),
  ('delivery_zones.manage',   'Manage delivery zones and fees',                             'Delivery',       true),
  ('products.manage',         'Add and edit products, services and prices',                 'Catalog',        true),
  ('products.view_cost',      'See cost prices',                                            'Catalog',        true),
  ('stock.adjust',            'Record purchases and stock adjustments',                     'Catalog',        true),
  ('orders.view',             'View all orders',                                            'Orders',         true),
  ('orders.manage_delivery',  'Assign delivery and update order status',                    'Orders',         true),
  ('receipts.print',          'Print and reprint receipts',                                 'Orders',         true),
  ('pos.sell',                'Sell on the POS screen',                                     'POS',            true),
  ('pos.discount',            'Apply discounts on the POS screen',                          'POS',            true),
  ('shifts.view_all',         'View every cashier shift',                                   'POS',            true),
  ('reviews.moderate',        'Approve or reject product reviews',                          'Content',        true),
  ('content.manage',          'Manage announcements and customer messages',                 'Content',        true),
  ('delivery.perform',        'See assigned deliveries and update their status',            'Delivery',       true);

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'products.manage'),
  ('admin', 'products.view_cost'),
  ('admin', 'stock.adjust'),
  ('admin', 'orders.view'),
  ('admin', 'orders.manage_delivery'),
  ('admin', 'receipts.print'),
  ('admin', 'reports.sales_total'),
  ('admin', 'reports.slow_products'),
  ('cashier', 'pos.sell'),
  ('cashier', 'receipts.print'),
  ('cashier', 'payments.record_cash'),
  ('delivery', 'delivery.perform'),
  ('delivery', 'payments.record_cash'); -- cash on delivery, assigned orders only (checked in the route)

INSERT INTO settings (key, value, is_public) VALUES
  ('shop',                       '{"name":"CHAFADIA ENTERPRISE","slogan":"Beauty. Wellness. Refreshment. Care.","phone":"+237 600 000 000","email":"contact@chafadia.com","address":"Yaoundé, Cameroon","latitude":3.848,"longitude":11.5021}', true),
  ('tax_rate_percent',           '0',  true),
  ('reservation_minutes_online', '30', false),
  ('reservation_hours_cash',     '48', false),
  ('slow_product_days',          '30', false),
  ('stuck_order_hours',          '48', false),
  ('alert_email',                '""', false);

INSERT INTO delivery_zones (name, description, fee, sort_order) VALUES
  ('Yaoundé - city',       'Home delivery inside Yaoundé',         1000,  1),
  ('Yaoundé - express',    'Same-day express delivery in Yaoundé', 2000,  2),
  ('Nationwide (Cameroon)','Delivery to other cities',             3500,  3),
  ('Worldwide',            'International shipping',               10000, 4);
