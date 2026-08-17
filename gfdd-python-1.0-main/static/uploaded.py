from PIL import Image,ImageFile
import numpy as np
import cv2
try:
    ImageFile.LOAD_TRUNCATED_IMAGES = True
    img = Image.open(r'D:\fiverr\master_App\tif\libtiffpic\text.tif')
    image = cv2.imread(r'D:\fiverr\master_App\tif\libtiffpic\text.tif', cv2.IMREAD_COLOR)

    # Check if the image has an alpha channel and discard it if present
    #if img.mode == 'RGBA':
    #img = img.convert('RGB')
    img_array = np.array(img)
    print(img_array)
    print(image)
except Exception as e:
    print(f"Error: {e}")
