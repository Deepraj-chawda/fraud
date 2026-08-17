/* eslint-disable @typescript-eslint/no-explicit-any */
export const handleApiError = (error: any): string => {
  if (error.response) {
    return `Server error: ${error.response.status} - ${error.response.statusText}`;
  } else if (error.request) {
    return "No response received from server. Please check your internet connection.";
  } else {
    return error.message || "An unknown error occurred";
  }
};
