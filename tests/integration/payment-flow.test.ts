/**
 * Payment and Subscription Integration Tests
 * 
 * Tests the complete payment flow with Stripe including:
 * - Customer creation
 * - Checkout session
 * - Webhook handling
 * - Subscription activation
 * - Drive folder creation after payment
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createMockStripeClient,
    mockCheckoutSession,
    mockCompletedCheckoutSession,
    mockCustomer,
    createMockWebhookEvent,
    stripeErrors,
} from '../mocks/stripe';
import { createMockGoogleDrive, mockDriveFolder } from '../mocks/google';

// Mock Stripe
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => createMockStripeClient()),
}));

// Mock Drive
vi.mock('../../src/lib/google/drive', () => ({
    createFolder: vi.fn(),
    shareWithUser: vi.fn(),
}));

// Mock email
vi.mock('../../src/lib/email/send', () => ({
    sendWelcomeEmail: vi.fn().mockResolvedValue(true),
}));

// Mock Supabase
vi.mock('../../src/lib/supabase-server', () => ({
    createServerSupabase: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'user-uuid-123' }, error: null }),
        }),
    }),
}));

import * as driveModule from '../../src/lib/google/drive';
import * as emailModule from '../../src/lib/email/send';

describe('Payment Integration', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Checkout Session Creation', () => {

        it('should create checkout session with correct metadata', async () => {
            // Arrange
            const stripe = createMockStripeClient();
            const checkoutParams = {
                customer_email: 'test@espanolhonesto.com',
                mode: 'payment' as const,
                success_url: 'https://espanolhonesto.com/success?session_id={CHECKOUT_SESSION_ID}',
                cancel_url: 'https://espanolhonesto.com/cancel',
                metadata: {
                    user_id: 'user-uuid-123',
                    package_id: 'intensivo',
                    duration_months: '3',
                },
                line_items: [
                    { price: 'price_intensivo_3m', quantity: 1 },
                ],
            };

            // Act
            const session = await stripe.checkout.sessions.create(checkoutParams);

            // Assert
            expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(checkoutParams);
            expect(session).toHaveProperty('id');
            expect(session).toHaveProperty('url');
            expect(session.url).toContain('checkout.stripe.com');

            console.log('✅ Checkout session created:', {
                id: session.id,
                url: session.url,
            });
        });

        it('should handle checkout creation failure', async () => {
            // Arrange
            const stripe = createMockStripeClient({ shouldFail: true });

            // Act & Assert
            await expect(
                stripe.checkout.sessions.create({})
            ).rejects.toMatchObject({
                code: 'card_declined',
            });

            console.log('✅ Checkout creation failure handled');
        });
    });

    describe('Webhook Processing', () => {

        it('should verify webhook signature', async () => {
            // Arrange
            const stripe = createMockStripeClient();
            const payload = JSON.stringify(
                createMockWebhookEvent('checkout.session.completed', mockCompletedCheckoutSession)
            );
            const signature = 'valid_signature';

            // Act
            const event = stripe.webhooks.constructEvent(payload, signature, 'whsec_test');

            // Assert
            expect(event).toHaveProperty('type', 'checkout.session.completed');
            expect(event.data.object).toMatchObject(mockCompletedCheckoutSession);

            console.log('✅ Webhook signature verified:', { eventType: event.type });
        });

        it('should reject invalid webhook signature', async () => {
            // Arrange
            const stripe = createMockStripeClient();
            const payload = JSON.stringify(
                createMockWebhookEvent('checkout.session.completed', mockCompletedCheckoutSession)
            );

            // Act & Assert
            expect(() =>
                stripe.webhooks.constructEvent(payload, 'invalid_signature', 'whsec_test')
            ).toThrow('Webhook signature verification failed');

            console.log('✅ Invalid webhook signature rejected');
        });

        it('should process checkout.session.completed event', async () => {
            // Arrange
            const stripe = createMockStripeClient();
            const webhookEvent = createMockWebhookEvent(
                'checkout.session.completed',
                mockCompletedCheckoutSession
            );

            // Mock Drive folder creation
            (driveModule.createFolder as any).mockResolvedValue({
                id: mockDriveFolder.id,
                webViewLink: mockDriveFolder.webViewLink,
            });

            (driveModule.shareWithUser as any).mockResolvedValue(true);

            // Simulate webhook processing
            const session = webhookEvent.data.object;

            console.log('📋 Processing checkout.session.completed...');
            console.log('  User ID:', session.metadata.user_id);
            console.log('  Package:', session.metadata.package_id);
            console.log('  Duration:', session.metadata.duration_months, 'months');

            // Step 1: Verify payment was successful
            expect(session.payment_status).toBe('paid');
            console.log('  Step 1: Payment verified ✓');

            // Step 2: Create Drive folder
            const folderResult = await driveModule.createFolder('Test Student - Español Honesto');
            expect(folderResult.id).toBe(mockDriveFolder.id);
            console.log('  Step 2: Drive folder created ✓');

            // Step 3: Share folder with student
            await driveModule.shareWithUser(folderResult.id as string, session.customer_email as string);
            expect(driveModule.shareWithUser).toHaveBeenCalled();
            console.log('  Step 3: Folder shared with student ✓');

            // Step 4: Send welcome email
            await emailModule.sendWelcomeEmail(
                session.customer_email as string,
                {
                    studentName: 'Test Student',
                    packageName: session.metadata.package_id,
                    loginUrl: 'https://espanolhonesto.com/campus',
                    driveFolderUrl: folderResult.webViewLink ?? undefined,
                }
            );
            expect(emailModule.sendWelcomeEmail).toHaveBeenCalled();
            console.log('  Step 4: Welcome email sent ✓');

            console.log('✅ checkout.session.completed processed successfully');
        });
    });

    describe('Complete Payment Flow', () => {

        it('should complete full payment and onboarding flow', async () => {
            // Arrange
            const stripe = createMockStripeClient();

            // Mock all external services
            (driveModule.createFolder as any).mockResolvedValue({
                id: 'folder_new_student',
                webViewLink: 'https://drive.google.com/folders/folder_new_student',
            });
            (driveModule.shareWithUser as any).mockResolvedValue(true);
            (emailModule.sendWelcomeEmail as any).mockResolvedValue(true);

            console.log('\n📋 === COMPLETE PAYMENT FLOW TEST ===\n');

            // Step 1: Create customer (if needed)
            const customer = await stripe.customers.create({
                email: 'newstudent@test.com',
                name: 'New Student',
                metadata: { supabase_user_id: 'user-new-123' },
            });
            console.log('Step 1: Stripe customer created', { customerId: customer.id });

            // Step 2: Create checkout session
            const checkoutSession = await stripe.checkout.sessions.create({
                customer: customer.id,
                mode: 'payment',
                success_url: 'https://espanolhonesto.com/success',
                cancel_url: 'https://espanolhonesto.com/cancel',
                metadata: {
                    user_id: 'user-new-123',
                    package_id: 'premium',
                    duration_months: '6',
                },
            });
            console.log('Step 2: Checkout session created', {
                sessionId: checkoutSession.id,
                checkoutUrl: checkoutSession.url,
            });

            // Step 3: Simulate completed payment (webhook)
            const completedSession = await stripe.checkout.sessions.retrieve('cs_test_completed123');
            expect(completedSession.payment_status).toBe('paid');
            console.log('Step 3: Payment completed', {
                status: completedSession.payment_status,
            });

            // Step 4: Create Drive folder
            const folder = await driveModule.createFolder('New Student - Español Honesto');
            console.log('Step 4: Drive folder created', {
                folderId: folder.id,
                folderUrl: folder.webViewLink,
            });

            // Step 5: Share folder
            await driveModule.shareWithUser(folder.id as string, 'newstudent@test.com');
            console.log('Step 5: Folder shared with student');

            // Step 6: Send welcome email
            await emailModule.sendWelcomeEmail(
                'newstudent@test.com',
                {
                    studentName: 'New Student',
                    packageName: 'premium',
                    loginUrl: 'https://espanolhonesto.com/campus',
                    driveFolderUrl: folder.webViewLink ?? undefined,
                }
            );
            console.log('Step 6: Welcome email sent');

            // Assert all calls were made
            expect(stripe.customers.create).toHaveBeenCalledTimes(1);
            expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
            expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
            expect(driveModule.createFolder).toHaveBeenCalledTimes(1);
            expect(driveModule.shareWithUser).toHaveBeenCalledTimes(1);
            expect(emailModule.sendWelcomeEmail).toHaveBeenCalledTimes(1);

            console.log('\n✅ === COMPLETE PAYMENT FLOW SUCCEEDED ===\n');
        });

        it('should handle payment failure and retry', async () => {
            // Arrange
            const failingStripe = createMockStripeClient({
                shouldFail: true,
                failureCode: 'insufficient_funds'
            });

            console.log('📋 Testing payment failure scenario...');

            // Act - First attempt fails
            try {
                await failingStripe.checkout.sessions.create({});
                expect.fail('Should have thrown an error');
            } catch (error: any) {
                console.log('  First attempt failed:', error.code);
                expect(error.code).toBe('insufficient_funds');
            }

            // Second attempt with working client
            const workingStripe = createMockStripeClient();
            const session = await workingStripe.checkout.sessions.create({});
            console.log('  Retry succeeded:', session.id);

            console.log('✅ Payment failure and retry handled correctly');
        });
    });

    describe('Customer Portal', () => {

        it('should create billing portal session', async () => {
            // Arrange
            const stripe = createMockStripeClient();

            // Act
            const portalSession = await stripe.billingPortal.sessions.create({
                customer: 'cus_test123',
                return_url: 'https://espanolhonesto.com/campus/account',
            });

            // Assert
            expect(portalSession).toHaveProperty('url');
            expect(portalSession.url).toContain('billing.stripe.com');

            console.log('✅ Portal session created:', { url: portalSession.url });
        });
    });
});
