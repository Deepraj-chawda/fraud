import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const Index: React.FC = () => {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto pt-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Enterprise Image Processing & Analysis
          </h1>
          <p className="text-xl text-slate-600 max-w-3xl mx-auto">
            Upload, analyze, and extract valuable metadata from your images with our advanced processing tools
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>Get Metadata</CardTitle>
              <CardDescription>
                Extract comprehensive metadata from your images
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">
                Upload multiple images and extract detailed EXIF data, dimensions, color profiles, and more.
              </p>
            </CardContent>
            <CardFooter>
              <Button onClick={() => navigate('/metadata')} className="w-full">
                Extract Metadata
              </Button>
            </CardFooter>
          </Card>
          
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>OCR Analysis</CardTitle>
              <CardDescription>
                Extract text from images with advanced OCR
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">
                Recognize and extract text from images using our high-accuracy optical character recognition.
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full">Coming Soon</Button>
            </CardFooter>
          </Card>
          
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>Image Analytics</CardTitle>
              <CardDescription>
                Get insights from your image collections
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600">
                Generate reports and analytics based on your image metadata and processing results.
              </p>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full">Coming Soon</Button>
            </CardFooter>
          </Card>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-8 mb-16">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Ready to get started?</h2>
              <p className="text-slate-600">Upload your first image and explore our powerful features</p>
            </div>
            <Button size="lg" onClick={() => navigate('/metadata')}>
              Get Started
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;








