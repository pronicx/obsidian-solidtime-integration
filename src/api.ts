import { requestUrl, RequestUrlParam, Notice } from 'obsidian';
import {
    TimeEntryResource,
    ProjectResource,
    TaskResource,
    TagResource,
    PersonalMembershipResource,
    TimeEntryStartPayload,
    TimeEntryStopPayload,
    UserResource,         // <-- Add UserResource
    MemberResource,       // <-- Add MemberResource
    PaginatedResponse,
    TagStoreRequest,
    TimeEntryListResponse,
    // Add other needed types like ClientResource if used
} from './types'; // Adjust path

export class SolidTimeApi {
    private apiKey: string;
    private baseUrl: string;

    constructor(apiKey: string, baseUrl: string) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Ensure no trailing slash
    }

    private async request<T>(options: RequestUrlParam): Promise<T> {
        if (!this.apiKey) {
            throw new Error("SolidTime API Key is not configured.");
        }
        if (!this.baseUrl) {
            throw new Error("SolidTime API Base URL is not configured.");
        }

        const defaultHeaders = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        options.headers = { ...defaultHeaders, ...options.headers };

        // --- Refined URL Handling ---
        let finalUrl = options.url;
        // Check if the provided URL is already absolute
        if (finalUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
            // Prepend base URL only if it's not already absolute
            const separator = finalUrl.startsWith('/') ? '' : '/';
            finalUrl = `${this.baseUrl}${separator}${finalUrl}`;
        }
        options.url = finalUrl; // Update options with the final URL
        // --- End Refined URL Handling ---

        try {
            const response = await requestUrl(options);
            // ... (rest of the error handling) ...
            if (response.status >= 200 && response.status < 300) {
                // Handle 204 No Content specifically
                if (response.status === 204) {
                    // Cast through unknown to satisfy the compiler for this specific case
                    return null as unknown as T;
                }
                return response.json as T;
            } else {
                // ... (error handling as before) ...
                console.error('SolidTime API Error Response:', response);
                let errorMsg = `SolidTime API Error: ${response.status}`;
                try {
                    const errorJson = response.json;
                    if (errorJson && errorJson.message) {
                        errorMsg += ` - ${errorJson.message}`;
                        if (errorJson.errors) {
                            errorMsg += ` (${JSON.stringify(errorJson.errors)})`;
                        }
                    }
                } catch (e) { /* Ignore if response is not JSON */ }
                new Notice(errorMsg, 5000);
                throw new Error(errorMsg);
            }
        } catch (error) {
            // ... (error handling as before) ...
            console.error('SolidTime API Request Failed:', error);
            if (error instanceof Error && !error.message.startsWith('SolidTime API Error')) {
                new Notice(`SolidTime Network Error: ${error.message}`, 5000);
            }
            throw error;
        }
    }

    // --- User & Membership ---

    async getMe(): Promise<UserResource> {
        // This endpoint returns { data: ... }
        const response = await this.request<{ data: UserResource }>({
            url: '/v1/users/me',
            method: 'GET',
        });
        if (!response?.data) throw new Error("API did not return expected data for /users/me.");
        return response.data;
    }


    // --- Add getMembers ---
    // Note: This returns a paginated list! Needs pagination handling.
    // For simplicity now, assume we fetch all or enough members on the first page.
    // A full implementation should use fetchAllPaginated or handle pages.
    async getMembers(orgId: string): Promise<MemberResource[]> {
        if (!orgId) return [];
        // Use fetchAllPaginated helper for member lists
        const initialUrl = `/v1/organizations/${orgId}/members`;
        try {
            // Assuming MemberResource list uses the standard PaginatedResponse structure
            return await this.fetchAllPaginated<MemberResource>(initialUrl);
        } catch (error) {
            console.error(`SolidTime: Failed to fetch members for org ${orgId}`, error);
            return []; // Return empty on error
        }

        /* // --- Simpler fetch (only first page) - replace with above for pagination ---
         const response = await this.request<PaginatedResponse<MemberResource>>({
             url: `/v1/organizations/${orgId}/members`,
             method: 'GET'
         });
         return response?.data || [];
         */
    }

     // ... rest of the API methods (getMemberships, getActiveTimeEntry, etc.) ...
     async getMemberships(): Promise<PersonalMembershipResource[]> { // Ensure return type is correct
        const response = await this.request<{ data: PersonalMembershipResource[] }>({
            url: '/v1/users/me/memberships',
            method: 'GET',
        });
        return response?.data || [];
    }

    async getActiveTimeEntry(): Promise<TimeEntryResource | null> {
        try {
            // This endpoint is independent of organization
            const response = await this.request<{ data: TimeEntryResource }>({
                url: '/v1/users/me/time-entries/active',
                method: 'GET',
            });
            return response.data;
        } catch (error: any) {
            // API returns 404 if no active entry, treat this as null, not an error
            if (error.message && error.message.includes('404')) {
                return null;
            }
            console.error("SolidTime: Error fetching active time entry", error);
            throw error; // Re-throw other errors
        }
    }

    // --- Time Entries ---

    async startTimeEntry(orgId: string, payload: TimeEntryStartPayload): Promise<TimeEntryResource> {
        if (!orgId) throw new Error("Organization ID is required to start a time entry.");
        if (!payload.member_id) throw new Error("Member ID is required to start a time entry.");

        const response = await this.request<{ data: TimeEntryResource }>({
            url: `/v1/organizations/${orgId}/time-entries`,
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return response.data;
    }

    async stopTimeEntry(orgId: string, timeEntryId: string, payload: TimeEntryStopPayload): Promise<TimeEntryResource> {
        if (!orgId) throw new Error("Organization ID is required to stop a time entry.");
        if (!timeEntryId) throw new Error("Time Entry ID is required to stop a time entry.");

        const response = await this.request<{ data: TimeEntryResource }>({
            url: `/v1/organizations/${orgId}/time-entries/${timeEntryId}`,
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        return response.data;
    }

    // --- Data Fetching (Implement pagination properly) ---

    async fetchAllPaginated<T>(initialUrl: string): Promise<T[]> {
        let allData: T[] = [];
        let nextPageUrl: string | null = initialUrl;

        while (nextPageUrl) {
            // Explicitly type the response variable
            const response: PaginatedResponse<T> = await this.request<PaginatedResponse<T>>({
                url: nextPageUrl, // Pass relative or absolute URL, request() handles base URL
                method: 'GET',
            });
            if (response && response.data) { // Check if response and data exist
                allData = allData.concat(response.data);
            }

            // Explicitly type rawNextUrl (though technically redundant now with typed response)
            const rawNextUrl: string | null = response?.links?.next ?? null;
            nextPageUrl = rawNextUrl; // Use the link directly

            // Safety break
            if (allData.length > 10000) {
                console.warn("SolidTime: Fetching aborted, exceeded 10000 items.");
                break;
            }
        }
        return allData;
    }



    async getProjects(orgId: string): Promise<ProjectResource[]> {
        if (!orgId) return [];
        // Fetch only non-archived projects by default
        // The API needs pagination handling.
        const initialUrl = `/v1/organizations/${orgId}/projects?archived=false`;
        return this.fetchAllPaginated<ProjectResource>(initialUrl);
    }

    async getTasks(orgId: string, projectId?: string | null): Promise<TaskResource[]> {
        if (!orgId) return [];
        let url = `/v1/organizations/${orgId}/tasks?done=false`; // Default to not done
        if (projectId) {
            url += `&project_id=${projectId}`;
        }
        return this.fetchAllPaginated<TaskResource>(url);
    }

    async getTags(orgId: string): Promise<TagResource[]> {
        if (!orgId) return [];
        // This endpoint doesn't seem paginated in the spec, but let's assume it might be or use a simpler fetch
        try {
            const response = await this.request<{ data: TagResource[] }>({
                url: `/v1/organizations/${orgId}/tags`,
                method: 'GET'
            });
            return response.data;
        } catch (e) {
            console.error("Failed to fetch tags", e);
            return [];
        }
    }

    async createTag(orgId: string, tagName: string): Promise<TagResource> {
        if (!orgId) throw new Error("Organization ID is required to create a tag.");
        if (!tagName) throw new Error("Tag name cannot be empty.");

        const payload: TagStoreRequest = { name: tagName };

        // This endpoint returns { data: TagResource }
        const response = await this.request<{ data: TagResource }>({
           url: `/v1/organizations/${orgId}/tags`,
           method: 'POST',
           body: JSON.stringify(payload),
        });
        if (!response?.data) throw new Error("API did not return expected data on create tag.");
        return response.data;
    }

    // Add getClients if needed, similar to getTags or getProjects
}