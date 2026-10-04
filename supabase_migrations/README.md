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
8. `20261003_dynamic_deposits_admin_auth.sql`

For the current production database, run only the new incremental migration:

1. `20261003_dynamic_deposits_admin_auth.sql`

The latest migration is additive: it adds a booking deposit percentage, optional deposit cap, vehicle-specific refundable security deposit fields, and repairs the explicitly authorised admin account confirmation state. Review it in Supabase SQL editor before applying. Do not run destructive schema resets against production.
