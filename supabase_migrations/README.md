# Supabase migration order

The project already had the core fleet, driver verification, production workflow, booking management, fleet image and initial Stripe payment migrations. The owner has stated those earlier migrations have been run in Supabase.

For a fresh database, run these in order:

1. `create_cars_table.sql`
2. `create_driver_verifications.sql`
3. `20261003_production_workflows.sql`
4. `20261003_booking_management.sql`
5. `20261003_fleet_images.sql`
6. `20261003_stripe_payments.sql`
7. `20261003_booking_payment_system.sql`

For the current production database, run only the new incremental migration:

1. `20261003_booking_payment_system.sql`

This migration is additive: it extends `cars` and `bookings`, creates payment, hold, refund, settings, inspection and Stripe webhook event tables, replaces `bv_submit` with the payment-aware version, and adds `bv_vehicle_available`. Review it in Supabase SQL editor before applying. Do not run destructive schema resets against production.
