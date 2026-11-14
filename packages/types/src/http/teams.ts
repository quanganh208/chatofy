import { z } from 'zod';

/**
 * A member's role in a team. Stored as text in `TeamMember.role` and narrowed
 * here, at the boundary, so a new role is a contract change rather than a
 * column migration.
 */
export const teamRoleSchema = z.enum(['owner', 'admin', 'member']);
export type TeamRole = z.infer<typeof teamRoleSchema>;
