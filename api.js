// api.js
import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:3000",
});

let accessToken = null;
let refreshToken = null;

export function setTokens(tokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
}

// Thêm access token vào header
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return config;
});

// Xử lý khi access token hết hạn
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const res = await axios.post("http://localhost:3000/refresh", {
          token: refreshToken,
        });

        accessToken = res.data.accessToken;
        originalRequest.headers["Authorization"] = `Bearer ${accessToken}`;

        return api(originalRequest); // retry request ban đầu
      } catch (err) {
        console.error("Refresh token failed", err);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
