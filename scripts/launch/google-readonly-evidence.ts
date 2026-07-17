import { calendar as calendarApi } from '@googleapis/calendar';
import { docs as docsApi } from '@googleapis/docs';
import { drive as driveApi } from '@googleapis/drive';
import * as dotenv from 'dotenv';
import { JWT } from 'google-auth-library';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';

type Status = 'ok' | 'warning' | 'failed';

interface Check {
    status: Status;
    name: string;
    message: string;
    details?: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    envFile: string;
    checks: Check[];
}

const envFile = readArgValue('--env-file') || '.env';
dotenv.config({ path: envFile, quiet: true });

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-google-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const adminEmail = process.env.GOOGLE_ADMIN_EMAIL;
const driveRootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
const templateDocId = process.env.GOOGLE_TEMPLATE_DOC_ID;

const checks: Check[] = [checkEnvironment()];

if (serviceAccountEmail && serviceAccountPrivateKey && adminEmail && driveRootFolderId && templateDocId) {
    const auth = new JWT({
        email: serviceAccountEmail,
        key: normalizeGooglePrivateKey(serviceAccountPrivateKey),
        scopes: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/documents',
        ],
        subject: adminEmail,
    });

    checks.push(await checkGoogleAuth(auth));

    const drive = driveApi({ version: 'v3', auth });
    const docs = docsApi({ version: 'v1', auth });
    const calendar = calendarApi({ version: 'v3', auth });

    checks.push(await checkDriveFile(drive, driveRootFolderId, 'drive_root', 'application/vnd.google-apps.folder'));
    checks.push(await checkDriveChildrenAggregate(drive, driveRootFolderId));
    checks.push(await checkDrivePermissions(drive, driveRootFolderId, 'drive_root_permissions'));
    checks.push(await checkDriveFile(drive, templateDocId, 'template_doc_drive', 'application/vnd.google-apps.document'));
    checks.push(await checkDrivePermissions(drive, templateDocId, 'template_doc_permissions'));
    checks.push(await checkDocsTemplate(docs, templateDocId));
    checks.push(await checkCalendarPrimary(calendar));
    checks.push(await checkCalendarFreeBusy(calendar, adminEmail));
}

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    envFile,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:google-readonly] Status: ${status}`);
console.log(`[launch:google-readonly] Failed: ${failed.length}`);
console.log(`[launch:google-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:google-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkEnvironment(): Check {
    const missing = [
        ['GOOGLE_SERVICE_ACCOUNT_EMAIL', serviceAccountEmail],
        ['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', serviceAccountPrivateKey],
        ['GOOGLE_ADMIN_EMAIL', adminEmail],
        ['GOOGLE_DRIVE_ROOT_FOLDER_ID', driveRootFolderId],
        ['GOOGLE_TEMPLATE_DOC_ID', templateDocId],
    ].filter(([, value]) => !value).map(([key]) => key);

    const privateKeyShape = serviceAccountPrivateKey?.includes('PRIVATE KEY') ? 'present_private_key_shape' : serviceAccountPrivateKey ? 'present_unrecognized' : 'missing';

    return {
        status: missing.length > 0 ? 'failed' : 'ok',
        name: 'environment_shape',
        message: missing.length === 0
            ? 'Google Workspace environment variables are present with a private-key-shaped value.'
            : 'Google Workspace environment variables are incomplete.',
        details: [
            `env_file=${envFile}`,
            `missing=${missing.length === 0 ? 'none' : missing.join(', ')}`,
            `service_account=${maskEmail(serviceAccountEmail)}`,
            `admin_subject=${maskEmail(adminEmail)}`,
            `private_key=${privateKeyShape}`,
            `drive_root=${compactId(driveRootFolderId)}`,
            `template_doc=${compactId(templateDocId)}`,
        ],
    };
}

async function checkGoogleAuth(auth: JWT): Promise<Check> {
    try {
        await auth.authorize();
        return {
            status: 'ok',
            name: 'google_dwd_auth_readonly',
            message: 'Service account authorization with the configured impersonated admin subject succeeded.',
            details: [
                `service_account=${maskEmail(serviceAccountEmail)}`,
                `admin_subject=${maskEmail(adminEmail)}`,
                'scopes=app-configured-drive|calendar|calendar.events|documents',
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'google_dwd_auth_readonly',
            message: 'Service account authorization failed for the configured impersonated admin subject.',
            details: [safeErrorMessage(error)],
        };
    }
}

async function checkDriveFile(
    drive: ReturnType<typeof driveApi>,
    fileId: string,
    name: string,
    expectedMimeType: string,
): Promise<Check> {
    try {
        const response = await drive.files.get({
            fileId,
            supportsAllDrives: true,
            fields: 'id,name,mimeType,trashed,webViewLink,capabilities(canAddChildren,canEdit,canShare)',
        });
        const file = response.data;
        const problems = [
            file.trashed ? 'trashed=true' : '',
            file.mimeType !== expectedMimeType ? `mime_mismatch=${file.mimeType ?? 'missing'}` : '',
        ].filter(Boolean);

        return {
            status: problems.length > 0 ? 'failed' : 'ok',
            name,
            message: problems.length === 0
                ? `${name} metadata is readable and has the expected Google MIME type.`
                : `${name} metadata is readable but does not match expected shape.`,
            details: [
                `id=${compactId(file.id)}`,
                `name=${safeName(file.name)}`,
                `mime=${file.mimeType ?? 'missing'}`,
                `trashed=${Boolean(file.trashed)}`,
                `link_host=${hostOnly(file.webViewLink)}`,
                `can_add_children=${Boolean(file.capabilities?.canAddChildren)}`,
                `can_edit=${Boolean(file.capabilities?.canEdit)}`,
                `can_share=${Boolean(file.capabilities?.canShare)}`,
                ...problems,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name,
            message: `${name} metadata could not be read.`,
            details: [`id=${compactId(fileId)}`, safeErrorMessage(error)],
        };
    }
}

async function checkDrivePermissions(
    drive: ReturnType<typeof driveApi>,
    fileId: string,
    name: string,
): Promise<Check> {
    try {
        const response = await drive.permissions.list({
            fileId,
            supportsAllDrives: true,
            fields: 'permissions(id,type,role,allowFileDiscovery,deleted)',
        });
        const permissions = response.data.permissions ?? [];
        const active = permissions.filter((permission) => !permission.deleted);
        const anyone = active.filter((permission) => permission.type === 'anyone');
        const user = active.filter((permission) => permission.type === 'user');
        const writer = active.filter((permission) => permission.role === 'writer' || permission.role === 'owner');

        return {
            status: 'ok',
            name,
            message: `${name} are readable as aggregate metadata.`,
            details: [
                `file=${compactId(fileId)}`,
                `active_permissions=${active.length}`,
                `anyone_permissions=${anyone.length}`,
                `user_permissions=${user.length}`,
                `writer_or_owner_permissions=${writer.length}`,
                `anyone_roles=${anyone.map((permission) => permission.role ?? 'unknown').join('|') || 'none'}`,
                `anyone_discoverable=${anyone.some((permission) => permission.allowFileDiscovery === true)}`,
            ],
        };
    } catch (error) {
        return {
            status: 'warning',
            name,
            message: `${name} could not be listed; file metadata checks may still be valid.`,
            details: [`file=${compactId(fileId)}`, safeErrorMessage(error)],
        };
    }
}

async function checkDriveChildrenAggregate(
    drive: ReturnType<typeof driveApi>,
    folderId: string,
): Promise<Check> {
    try {
        const mimeCounts = new Map<string, number>();
        let total = 0;
        let folders = 0;
        let oldestCreatedAt: string | null = null;
        let newestCreatedAt: string | null = null;
        let pageToken: string | undefined;

        do {
            const response = await drive.files.list({
                q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                pageSize: 1000,
                pageToken,
                fields: 'nextPageToken,files(mimeType,createdTime)',
            });

            for (const file of response.data.files ?? []) {
                const mimeType = file.mimeType ?? 'unknown';
                mimeCounts.set(mimeType, (mimeCounts.get(mimeType) ?? 0) + 1);
                total += 1;
                if (mimeType === 'application/vnd.google-apps.folder') folders += 1;
                if (file.createdTime) {
                    oldestCreatedAt = !oldestCreatedAt || file.createdTime < oldestCreatedAt
                        ? file.createdTime
                        : oldestCreatedAt;
                    newestCreatedAt = !newestCreatedAt || file.createdTime > newestCreatedAt
                        ? file.createdTime
                        : newestCreatedAt;
                }
            }

            pageToken = response.data.nextPageToken ?? undefined;
        } while (pageToken);

        return {
            status: total === 0 ? 'ok' : 'warning',
            name: 'drive_root_children_aggregate',
            message: total === 0
                ? 'The configured Drive root has no active direct children.'
                : 'The configured Drive root has active direct children that require an environment-specific fixture review.',
            details: [
                `root=${compactId(folderId)}`,
                `active_direct_children=${total}`,
                `folders=${folders}`,
                `mime_counts=${[...mimeCounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([mime, count]) => `${mime}:${count}`).join('|') || 'none'}`,
                `oldest_created_at=${oldestCreatedAt ?? 'none'}`,
                `newest_created_at=${newestCreatedAt ?? 'none'}`,
                'names_or_owners_read=false',
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'drive_root_children_aggregate',
            message: 'The configured Drive root direct children could not be counted.',
            details: [`root=${compactId(folderId)}`, safeErrorMessage(error)],
        };
    }
}

async function checkDocsTemplate(
    docs: ReturnType<typeof docsApi>,
    documentId: string,
): Promise<Check> {
    try {
        const response = await docs.documents.get({
            documentId,
            fields: 'documentId,title',
        });

        return {
            status: 'ok',
            name: 'template_doc_docs_api_readonly',
            message: 'Template document is readable through the Google Docs API.',
            details: [
                `document=${compactId(response.data.documentId)}`,
                `title=${safeName(response.data.title)}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'template_doc_docs_api_readonly',
            message: 'Template document could not be read through the Google Docs API.',
            details: [`document=${compactId(documentId)}`, safeErrorMessage(error)],
        };
    }
}

async function checkCalendarPrimary(calendar: ReturnType<typeof calendarApi>): Promise<Check> {
    try {
        const response = await calendar.calendarList.get({
            calendarId: 'primary',
        });
        const item = response.data;

        return {
            status: 'ok',
            name: 'calendar_primary_readonly',
            message: 'Impersonated admin primary calendar metadata is readable.',
            details: [
                `calendar_id=${compactId(item.id)}`,
                `summary=${safeCalendarSummary(item.summary)}`,
                `time_zone=${item.timeZone ?? 'unknown'}`,
                `access_role=${item.accessRole ?? 'unknown'}`,
                `primary=${Boolean(item.primary)}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'calendar_primary_readonly',
            message: 'Impersonated admin primary calendar metadata could not be read.',
            details: [safeErrorMessage(error)],
        };
    }
}

async function checkCalendarFreeBusy(
    calendar: ReturnType<typeof calendarApi>,
    email: string,
): Promise<Check> {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    try {
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: now.toISOString(),
                timeMax: oneHourLater.toISOString(),
                timeZone: 'Europe/Madrid',
                items: [{ id: 'primary' }, { id: email }],
            },
        });
        const calendars = response.data.calendars ?? {};
        const errors = Object.values(calendars)
            .flatMap((entry) => entry.errors ?? [])
            .map((entry) => `${entry.domain ?? 'unknown'}:${entry.reason ?? 'unknown'}`);

        return {
            status: errors.length > 0 ? 'failed' : 'ok',
            name: 'calendar_freebusy_readonly',
            message: errors.length === 0
                ? 'FreeBusy is readable for the configured admin primary calendar.'
                : 'FreeBusy returned calendar-level errors.',
            details: [
                `admin_subject=${maskEmail(email)}`,
                `window_minutes=60`,
                `calendar_keys=${Object.keys(calendars).map(compactId).join('|') || 'none'}`,
                `busy_blocks=${Object.values(calendars).reduce((sum, entry) => sum + (entry.busy?.length ?? 0), 0)}`,
                ...(errors.length > 0 ? [`errors=${errors.join('|')}`] : []),
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'calendar_freebusy_readonly',
            message: 'FreeBusy could not be queried for the configured admin primary calendar.',
            details: [safeErrorMessage(error)],
        };
    }
}

function readArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
}

function compactId(id: string | null | undefined): string {
    if (!id) return 'missing';
    if (id.length <= 12) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function maskEmail(email: string | null | undefined): string {
    if (!email || !email.includes('@')) return email ? 'present_unrecognized' : 'missing';
    const [local, domain] = email.split('@');
    const head = local.slice(0, 1) || '*';
    return `${head}***@${domain}`;
}

function safeName(value: string | null | undefined): string {
    if (!value) return 'missing';
    return value.replace(/\|/g, '/').replace(/\r?\n/g, ' ').slice(0, 80);
}

function safeCalendarSummary(value: string | null | undefined): string {
    if (!value) return 'missing';
    return value.includes('@') ? maskEmail(value) : safeName(value);
}

function hostOnly(value: string | null | undefined): string {
    if (!value) return 'missing';
    try {
        return new URL(value).host;
    } catch {
        return 'unparseable';
    }
}

function safeErrorMessage(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [
        serviceAccountPrivateKey,
        serviceAccountPrivateKey?.replace(/\\n/g, '\n'),
    ]) {
        if (secret) message = message.replaceAll(secret, '[redacted]');
    }
    return message.replace(/\r?\n/g, ' ').slice(0, 500);
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Google Workspace Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Env file: ${report.envFile}`,
        '',
        '## Scope',
        '',
        'This check is read-only. It authorizes with the app-configured Google scopes and impersonated admin subject, reads Drive root/template metadata, counts active direct root children without reading their names or owners, reads aggregate permission metadata, reads minimal Google Docs template metadata, and reads primary-calendar/FreeBusy metadata. It does not create, copy, update, delete, share, revoke, append, schedule, cancel, send invitations, retrieve secret values, or write Supabase.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    lines.push('## Final Closure Note');
    lines.push('');
    lines.push('This evidence supports Google integration readiness and root-cleanliness review only. It does not replace the final write-path smoke for folder creation, template copying, Docs append, Meet event creation, teacher FreeBusy conflict behavior, cancellation, invitation delivery, or dashboard/key-rotation review.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
