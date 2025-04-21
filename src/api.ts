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

    private async request<T>(
        options: RequestUrlParam,
        // ADD optional parameter: array of status codes to treat as non-errors
        allowedNon2xxStatuses: number[] = []
    ): Promise<T | null> { // Return type might now be null if allowed status occurs

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

        let finalUrl = options.url;
        // Check if the provided URL is already absolute
        if (finalUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
            // Prepend base URL only if it's not already absolute
            const separator = finalUrl.startsWith('/') ? '' : '/';
            finalUrl = `${this.baseUrl}${separator}${finalUrl}`;
        }
        options.url = finalUrl; // Update options with the final URL

        // console.log(`DEBUG: Requesting URL: ${options.method || 'GET'} ${finalUrl}`);
        // console.log(`DEBUG: Allowed Non-2xx Statuses: [${allowedNon2xxStatuses.join(', ')}]`);

        try {
            options.throw = false;
            const response = await requestUrl(options);

            const isAllowedNon2xx = allowedNon2xxStatuses.includes(response.status);
            // console.log(`DEBUG: Response Status: ${response.status}, Is Allowed Non-2xx? ${isAllowedNon2xx}`);

            // Check if status is successful (2xx) OR if it's in the allowed non-2xx list
            if ((response.status >= 200 && response.status < 300) || isAllowedNon2xx) {

                // Handle specific known statuses if needed
                if (response.status === 204) {
                    // Cast through unknown to satisfy the compiler for this specific case
                    return null as unknown as T; // Still handle 204 specifically
                }
                // If it was an allowed non-2xx status (like 404), return null
                // The caller needs to check the response status if it cares *which* allowed status it was
                // For our 404 case in getActiveTimeEntry, returning null is the desired outcome.
                if (isAllowedNon2xx) {
                    // console.log(`DEBUG: Status ${response.status} was in allowed list, returning null.`); // Debug log
                    return null;
                }

                // Otherwise (it was a 2xx), parse JSON
                // Check for body before parsing (optional but safer)
                if (response.arrayBuffer?.byteLength > 0 || response.text) {
                    return response.json as T;
                } else {
                    // Return null for 2xx with empty body too
                    return null;
                }

            } else {
                // --- Status was NOT successful AND NOT in the allowed list ---
                // Log the error response details
                console.error('SolidTime API Error Response:', response);
                let errorMsg = `SolidTime API Error: ${response.status}`;

                let errorJson: any = null; // Define errorJson to potentially hold parsed error

                // Attempt to parse the error response body for more details
                try {
                    // Check if response.json is available and not empty before trying to parse
                    if (response.arrayBuffer?.byteLength > 0 || response.text) {
                        errorJson = response.json; // Try parsing JSON
                    }
                    // Append message and errors if available in the parsed JSON
                    if (errorJson && errorJson.message) {
                        errorMsg += ` - ${errorJson.message}`;
                        if (errorJson.errors) {
                            errorMsg += ` (${JSON.stringify(errorJson.errors)})`;
                        }
                    } else if (response.text) { // Fallback to text if no JSON message
                        errorMsg += ` - ${response.text.substring(0, 100)}`; // Show snippet
                    }
                } catch (e) {
                    // Handle cases where the error response wasn't valid JSON
                    console.warn("SolidTime: Could not parse error response as JSON.", e);
                    if (response.text) { // Fallback to text if JSON parsing failed
                        errorMsg += ` - ${response.text.substring(0, 100)}`; // Show snippet of text response
                    }
                }
                // Show a notice to the user about the error
                new Notice(errorMsg, 5000);
                // Throw an error to be caught by the calling function
                throw new Error(errorMsg);
            }
        } catch (error) {
            // Catch network errors from requestUrl or errors thrown above
            console.error('SolidTime API Request Failed:', error);
            // Avoid showing duplicate notices if the error was already created and includes the status code
            if (error instanceof Error && !error.message.startsWith('SolidTime API Error:')) {
                // Likely a network error (fetch failed, DNS, CORS etc.)
                new Notice(`SolidTime Network Error: ${error.message}`, 5000);
            }
            throw error; // Re-throw the error so the calling function knows something went wrong
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
            }, [404]);
            if (response === null) { return null; } // Handles 404 or 204 from request
            return response?.data || null;

        } catch (error: any) {
            console.error("SolidTime: Unexpected error fetching active time entry", error);
            throw error;
            // let is404 = false;
            // if (error instanceof Error) {
            //     // Check if the message we constructed in request() includes 404
            //     if (error.message && error.message.includes("status 404")) {
            //         is404 = true;
            //     }
            //     // Alternatively, if the original error object is accessible (depends on requestUrl implementation)
            //     // you might check error.status directly, e.g., if (error.status === 404) is404 = true;
            //     // But checking the message is safer based on our current request wrapper.
            // }

            // if (is404) {
            //     // It's expected that 404 means no active timer, return null silently
            //     // console.log("SolidTime: No active timer found (404)."); // Optional debug log, remove for release
            //     return null;
            // } else {
            //     // For any other error (network, auth, server error), log it and re-throw
            //     console.error("SolidTime: Error fetching active time entry (non-404)", error);
            //     // The Notice might already be shown by the request method, so avoid duplicating it here.
            //     throw error;
            // }
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

        if (!response?.data) {
            throw new Error("API did not return expected data on start timer.");
        }

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

        if (!response?.data) {
            throw new Error("API did not return expected data on stop timer.");
        }

        return response.data;
    }

    // --- Data Fetching (Implement pagination properly) ---

    async fetchAllPaginated<T>(initialUrl: string): Promise<T[]> {
        let allData: T[] = [];
        let nextPageUrl: string | null = initialUrl;

        while (nextPageUrl) {
            // Explicitly type the response variable
            const response: PaginatedResponse<T> | null = await this.request<PaginatedResponse<T>>({
                url: nextPageUrl,
                method: 'GET',
                // No allowed non-2xx here unless specifically needed for a paginated endpoint
            });

            if (response && Array.isArray(response.data)) {
                // Only process if response and response.data are valid
                allData = allData.concat(response.data);

                // Safely access links only if response exists
                const rawNextUrl: string | null = response.links?.next ?? null;
                nextPageUrl = rawNextUrl;
            } else {
                // If response is null or structure is wrong, stop paginating
                if (response !== null) { // Log only if structure was wrong, not if request returned null purposefully (e.g., 204)
                    console.warn(`SolidTime: Unexpected response structure during pagination for URL: ${nextPageUrl}`, response);
                }
                nextPageUrl = null; // Stop the loop
            }
            // --- End Fix ---

            // Safety break remains the same
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
            return response?.data || [];
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

}