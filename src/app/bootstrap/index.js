
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../containers/App';
import '../styles/index.css';

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const nextInit = { ...init, credentials: init.credentials || "include" };
  if (nextInit.headers) {
    const headers = new Headers(nextInit.headers);
    const auth = headers.get("Authorization");
    if (auth && /^Bearer\s+(null|undefined|true|false|session|cookie-session)$/i.test(auth.trim())) {
      headers.delete("Authorization");
    }
    nextInit.headers = headers;
  }
  return nativeFetch(input, nextInit);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

