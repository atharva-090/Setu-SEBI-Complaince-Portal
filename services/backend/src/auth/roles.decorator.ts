import { SetMetadata } from '@nestjs/common';
import { Role } from '../database/entities/enums';

export const ROLES_KEY = 'roles';

/** Restricts a route to one or more roles. Empty = any authenticated user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
