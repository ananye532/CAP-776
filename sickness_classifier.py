a=0
b=0
c=0
d=0

sore_throat = bool(input("enter whether you have sore throat or not (yes/no): "))
cold = bool(input("enter whether you have cold or not (yes/no): "))
breathing_difficulty = bool(input("enter whether you have breathing difficulty or not (yes/no): "))
fever = bool(input("enter whether you have fever or not (yes/no): "))

if(sore_throat==True):
  print("cough is there")
elif(cold==True and sore_throat==False):
  print("cold is there")
elif(breathing_difficulty==True and sore_throat==True and cold==True):
  print("take patient to hospital")
elif(breathing_difficulty==True and sore_throat==False and cold==False):
  print("take patient to hospital")
elif(fever==False and sore_throat==False and cold==False and breathing_difficulty==False):
  print("patient is healthy")
else:
  print("patient is sick")
    
  
  
  
