# GlowEr Beauty Booking Bot — Bot specification

**Archetype:** booking

A Telegram bot for a beauty studio enabling clients to browse services, view portfolios, make auto-confirmed bookings (with optional staff selection), and submit reviews. Admins manage services, portfolio content, and respond to reviews with in-chat controls.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Beauty clients seeking appointments
- Studio owner and admins

## Success criteria

- Auto-confirmed bookings created
- Reviews submitted with photos
- Admins receive booking notifications and manage content

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with booking and service options
- **Book Service** (button, actor: user, callback: booking:start) — Initiate booking flow with service selection
- **View Services** (button, actor: user, callback: services:list) — Browse available services with descriptions and pricing
- **Portfolio** (button, actor: user, callback: portfolio:list) — View curated portfolio images grouped by service
- **Reviews** (button, actor: user, callback: reviews:list) — See client reviews with photos and admin responses
- **My Bookings** (button, actor: user, callback: bookings:history) — View personal booking history and details
- **/admin** (command, actor: admin, command: /admin) — Open admin menu for content management and settings

## Flows

### booking_flow
_Trigger:_ booking:start

1. Select service from list
2. Optionally select staff member
3. Choose available time slot
4. Enter contact information
5. Confirm booking
6. Send admin notifications

_Data touched:_ Booking, Service, User

### review_prompt
_Trigger:_ booking:completed

1. Wait 1 hour after appointment end time
2. Send review request with photo upload option
3. Store review and notify admins

_Data touched:_ Review, User

### admin_content_management
_Trigger:_ /admin

1. Access admin menu
2. Create/update/delete services
3. Upload portfolio items
4. Manage admin list
5. Export booking data

_Data touched:_ Service, PortfolioItem, Admin

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: persistent)_ — Client profile with booking history and reviews
  - fields: telegram_id, phone, booking_history, submitted_reviews
- **Booking** _(retention: persistent)_ — Confirmed appointment with service details
  - fields: service_id, staff_id, datetime, status, client_info
- **PortfolioItem** _(retention: persistent)_ — Image with caption and service associations
  - fields: image_url, caption, service_tags
- **Review** _(retention: persistent)_ — Client feedback with optional photos
  - fields: rating, text, photos, admin_response

## Integrations

- **Telegram** (required) — Bot API messaging, image handling, notifications
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Manage admin access list
- Create/update/delete services
- Upload portfolio images
- Respond to reviews
- Export booking history as CSV

## Notifications

- New booking alerts to owner/admins
- Review submission notifications to admins

## Permissions & privacy

- Collect phone number only if Telegram contact not available
- Store user-submitted photos securely
- Admins can only view their own content

## Edge cases

- No available time slots during booking
- Invalid phone number format
- Missing admin Telegram IDs during setup
- Overlapping bookings during slot selection

## Required tests

- End-to-end booking flow with auto-confirmation
- Review submission with multi-photo upload
- Admin content management (create/update/delete)
- Time slot validation for overbooking prevention

## Assumptions

- Admins will provide Telegram IDs for notification setup
- Working hours use 9-5 default with admin-configurable overrides
- Image storage uses Telegram's native media handling
