
import React from 'react';
import LoginForm from '@/components/LoginForm';
import AppLogo from '@/components/AppLogo';

const Login: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-lg overflow-hidden animate-fade-in">
        <div className="p-8 flex flex-col items-center">
          <div className="-mb-4">
            <AppLogo />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to access your account</p>
        </div>
        <div className="px-8 pb-8">
          <LoginForm />
        </div>
        <div className="p-4 text-center text-sm text-gray-600 border-t">
          Don't have an account? <a href="#" className="text-blue-600 hover:underline font-medium">Sign up</a>
        </div>
      </div>
    </div>
  );
};

export default Login;
