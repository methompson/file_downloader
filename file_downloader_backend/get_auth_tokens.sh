read -p "Enter your Email Address: " email
read -s -p "Enter your Password: " password

printf "\n\n"

firebaseProjectId=AIzaSyA1fEORIAxMNxYRKSgiWpyCRt_7EUv2FBM
locationUrl="https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$firebaseProjectId"

curl --location $locationUrl \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "returnSecureToken":true,
    "email":"'$email'",
    "password":"'$password'"
  }'