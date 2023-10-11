<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a name="readme-top"></a>

<!-- TABLE OF CONTENTS -->

 ## Table of Contents
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#folder-structure">Folder Structure</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
      </ul>
    </li>
  </ol>



<!-- ABOUT THE PROJECT -->
## About The Project

This is an IaC Pulumi project used to dyncamically provision vpc's, subnets, internet gateways and route tables in AWS. 

<p align="right"><a href="#readme-top">(back to top)</a></p>

### Folder Structure

The folder structure used for the project: 

* pulumi-aws
  * index.js
  * Pulumi.dev.yaml
  * Pulumi.demo.yaml
* README.md

Other development and dependency folders include:

* pulumi-aws
  * package.json
  * package-lock.json

<p align="right"><a href="#readme-top">(back to top)</a></p>

### Built With

* Pulumi
* Node
* aws-cli

<p align="right"><a href="#readme-top">(back to top)</a></p>

<!-- GETTING STARTED -->
## Getting Started

Clone this repository, and and follow the instructions to install pre-requisites before running the project

### Prerequisites

The project has node dependencies of Pulumi. In order to locally install these dependencies, the following command must be run in terminal opened inside project folder:
 ```sh
  npm install
  ```
This will locally install the dependencies inside a node_modules folder.
This is because the package.json is cloned from repo which contains all the projects' dependencies and the command `npm install` installs all the dependencies listed in package.json

Make sure pulumi and aws-cli are locally installed, and the aws account access credentials are stored under respective 'dev' and 'demo' profiles in .aws/config and .aws/credentials files locally.

The Pulumi.*.yaml files specify configuration information under aws namespace which assumes that the aws configurations are stored in the respective files under .aws folder locally.

In order to provision the resources on the AWS account for a certain profile, first switch to the pulumi stack using the command `pulumi stack select <stack_name>`, and then run the `update` command.

In order to destroy provisioned resources on the AWS account for a certain profile, first switch to the pulumi stack using the command `pulumi stack select <stack_name>`, and then run the `destroy` command.

Note : You can check current stack using `pulumi stack ls`    
    
<p align="right"><a href="#readme-top">(back to top)</a></p>



