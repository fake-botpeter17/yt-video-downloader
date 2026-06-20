import {useState} from "react"




function App() {

  const [url, setUrl] = useState("");

  return (
    <>
    <label htmlFor="URL">Enter Video link: </label>
    <input id="url_input" type="text" onChange={(e) => {setUrl(e.target.value)}}/>
    <br />
    <button onClick={() => {alert(url)}}>Submit</button>
    </>
  )
}

export default App
