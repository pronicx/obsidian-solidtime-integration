// Based on api-docs.json schemas

export interface ApiTokenResource {
	id: string;
	name: string;
	revoked: boolean;
	scopes: string[];
	created_at: string;
	expires_at: string | null;
}

export interface OrganizationResource {
	id: string;
	name: string;
	is_personal: boolean;
	billable_rate: number | null;
	employees_can_see_billable_rates: boolean;
	currency: string;
}

export interface PersonalMembershipResource {
	id: string; // Membership ID
	organization: {
		id: string;
		name: string;
		currency: string;
	};
	role: string;
}

// Add the UserResource interface definition:
export interface UserResource {
	id: string; // ID of user
	name: string; // Name of user
	email: string; // Email of user
	profile_photo_url: string; // Profile photo URL
	timezone: string; // Timezone (f.e. Europe/Berlin or America/New_York)
	week_start: Weekday; // Starting day of the week
}

// Add the Weekday enum if it's not already there:
export type Weekday =
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday"
	| "sunday";

// Need the MemberResource to get the member_id from the user_id
export interface MemberResource {
	id: string; // Membership ID (same as PersonalMembershipResource.id)
	user_id: string;
	name: string;
	email: string;
	role: string;
	is_placeholder: boolean;
	billable_rate: number | null;
}


export interface ProjectResource {
	id: string;
	name: string;
	color: string;
	client_id: string | null;
	is_archived: boolean;
	billable_rate: number | null;
	is_billable: boolean;
	estimated_time: number | null;
	spent_time: number;
	is_public: boolean;
}

export interface TaskResource {
	id: string;
	name: string;
	is_done: boolean;
	project_id: string;
	estimated_time: number | null;
	spent_time: number;
	created_at: string;
	updated_at: string;
}

export interface TagResource {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
}

export interface TagStoreRequest {
	name: string;
}

export interface TimeEntryResource {
	id: string;
	start: string; // ISO 8601 UTC
	end: string | null; // ISO 8601 UTC
	duration: number | null; // seconds
	description: string | null;
	task_id: string | null;
	project_id: string | null;
	organization_id: string;
	user_id: string; // User UUID
	tags: string[]; // Tag IDs
	billable: boolean;
}

// For API requests
export interface TimeEntryStartPayload {
    member_id: string;
    start: string; // ISO 8601 UTC
    billable: boolean;
    project_id?: string | null;
    task_id?: string | null;
    description?: string | null;
    tags?: string[] | null;
}

export interface TimeEntryStopPayload {
    end: string; // ISO 8601 UTC
    // Include other fields that might need updating on stop, if any
    // Based on PUT /time-entries/{timeEntry}, we likely need most fields again
    member_id: string;
    start: string; // Need original start time
    billable: boolean;
    project_id?: string | null;
    task_id?: string | null;
    description?: string | null;
    tags?: string[] | null;
}

// For paginated responses
export interface PaginatedResponse<T> {
    data: T[];
    links: {
        first: string | null;
        last: string | null;
        prev: string | null;
        next: string | null;
    };
    meta: {
        current_page: number;
        from: number | null;
        last_page: number;
        links: { url: string | null; label: string; active: boolean }[];
        path: string | null;
        per_page: number;
        to: number | null;
        total: number;
    };
}

// Specific for TimeEntry list which has different meta
export interface TimeEntryListResponse {
    data: TimeEntryResource[];
    meta: {
        total: number;
    };
}