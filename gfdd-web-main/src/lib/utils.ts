import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function validateFileImagePdf(files:File[]){
  const fileList =  Array.from(files);
  let flag: boolean = true;
  let message:string = null;
  if(fileList.length<1){
      message ='please upload at least one file.';
      flag = false;
      return {flag,message};
  }else if(fileList.length>20){
     message ='Supports uploading up to 20 files at once';
     flag = false;
     return {flag,message};
  }
  for(let i =0;i<fileList.length;i++){
   const file = fileList[i]
   
   if (!file.type.startsWith('image/')&& file.type !== 'application/pdf'){
      flag = false
      message ='Please upload supported image formats or PDF files.'
      break;
   }
   if (file.size/1012/1024>10){
      flag = false
      message ='The maximum size for a single file is 10MB.'
      break;
   }
  }
 const sum= fileList.reduce((sum,v)=>sum=sum+v.size,0);
  if(sum/1024/1024>20){
    flag = false
    message ='The maximum file upload size is 20MB.'
  }
  return {flag,message};
}
